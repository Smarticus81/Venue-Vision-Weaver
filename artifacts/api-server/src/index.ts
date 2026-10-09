import "./loadEnv.js";
import app from "./app";
import { logger } from "./lib/logger";
import { db, uploadIntentsTable } from "@workspace/db";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { startSessionWorker } from "./lib/sessionWorker.js";
import { startPhotoRetentionSweep } from "./lib/photoRetention.js";
import { startControlPlaneWorker } from "./control-plane/scheduler.js";
import { getAppBaseUrl } from "./lib/appUrl.js";
import {
  assertProductionEnvironment,
  productionEnvironmentWarnings,
} from "./lib/envValidation.js";
import {
  uploadIntentCleanupBatchSize,
  uploadIntentCleanupIntervalMinutes,
} from "./lib/sessionCleanupConfig.js";
import { ObjectStorageService } from "./lib/objectStorage.js";

const objectStorageService = new ObjectStorageService();

/**
 * Expired, never-consumed upload intents leave orphaned objects in the
 * private bucket (abandoned couple uploads, closed tabs). Runs at boot and
 * then on a timer, one batch at a time, so storage never fills unbounded.
 */
let uploadIntentSweepRunning = false;
async function cleanupExpiredUploadIntents(): Promise<void> {
  if (uploadIntentSweepRunning) return;
  uploadIntentSweepRunning = true;
  const batchSize = uploadIntentCleanupBatchSize();
  try {
    const expired = await db
      .select({
        id: uploadIntentsTable.id,
        objectKey: uploadIntentsTable.objectKey,
      })
      .from(uploadIntentsTable)
      .where(and(isNull(uploadIntentsTable.consumedAt), lt(uploadIntentsTable.expiresAt, new Date())))
      .orderBy(asc(uploadIntentsTable.expiresAt))
      .limit(batchSize);

    let deleted = 0;
    for (const intent of expired) {
      try {
        await objectStorageService.deleteObjectEntity(intent.objectKey);
        await db
          .delete(uploadIntentsTable)
          .where(and(eq(uploadIntentsTable.id, intent.id), isNull(uploadIntentsTable.consumedAt)));
        deleted += 1;
      } catch (deleteErr) {
        logger.warn(
          { err: deleteErr, intentId: intent.id, objectKey: intent.objectKey },
          "Failed to cleanup expired upload intent",
        );
      }
    }

    if (deleted > 0) {
      logger.info({ count: deleted, batchSize }, "Cleaned up expired unconsumed upload intents");
    }
  } catch (err) {
    logger.error({ err }, "Failed to cleanup expired upload intents");
  } finally {
    uploadIntentSweepRunning = false;
  }
}

// A stray rejected promise (background poller, webhook side effect, …) must
// not take the whole site down; log it and keep serving.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

const rawPort = process.env["PORT"];

assertProductionEnvironment();
for (const warning of productionEnvironmentWarnings()) {
  logger.warn(warning);
}

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const timers: NodeJS.Timeout[] = [];

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, appBaseUrl: getAppBaseUrl() }, "Server listening");
  void cleanupExpiredUploadIntents();
  const sweepInterval = setInterval(
    () => void cleanupExpiredUploadIntents(),
    uploadIntentCleanupIntervalMinutes() * 60 * 1000,
  );
  sweepInterval.unref();
  timers.push(sweepInterval);
  startSessionWorker();
  startPhotoRetentionSweep();
  startControlPlaneWorker();
});

// Stop accepting connections and clear our timers on a platform shutdown
// signal; in-flight requests finish, then the process exits. A hard deadline
// guards against a hung connection keeping the old instance alive forever.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  for (const timer of timers) clearInterval(timer);
  const deadline = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
  deadline.unref();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
