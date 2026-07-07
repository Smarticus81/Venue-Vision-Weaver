import { db, coupleSessionsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { processSession } from "./gallerySessionPipeline.js";
import { logger } from "./logger.js";

const MAX_CONCURRENT = 2;
const POLL_MS = 2000;

let running = 0;
const inFlight = new Set<number>();
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function runJob(sessionId: number): Promise<void> {
  running += 1;
  try {
    await processSession(sessionId);
  } catch (err) {
    logger.error({ err, sessionId }, "Session worker job threw");
  } finally {
    inFlight.delete(sessionId);
    running -= 1;
  }
}

async function tick(): Promise<void> {
  if (running >= MAX_CONCURRENT) return;

  const queued = await db
    .select({
      id: coupleSessionsTable.id,
      status: coupleSessionsTable.status,
    })
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.status, "pending"))
    .orderBy(asc(coupleSessionsTable.createdAt))
    .limit(20);

  for (const row of queued) {
    if (running >= MAX_CONCURRENT) break;
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    void runJob(row.id);
  }
}

export function startSessionWorker(): void {
  if (pollTimer) return;
  logger.info({ maxConcurrent: MAX_CONCURRENT }, "Session generation worker started");
  void tick();
  pollTimer = setInterval(() => {
    void tick();
  }, POLL_MS);
}
