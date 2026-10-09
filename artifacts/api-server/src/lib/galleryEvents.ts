import crypto from "crypto";
import {
  db,
  galleryEventsTable,
  coupleSessionsTable,
  type GalleryEventType,
  type GalleryEventSource,
} from "@workspace/db";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { logger } from "./logger.js";

/** Event types the public share page may post through POST /sessions/by-token/:token/events. */
export const SHARE_PAGE_EVENT_TYPES = ["shared", "cta_click", "download"] as const satisfies readonly GalleryEventType[];
export type SharePageEventType = (typeof SHARE_PAGE_EVENT_TYPES)[number];

export interface SessionGalleryStats {
  /** First "sent" event (gallery emailed to the couple). */
  emailedAt: Date | null;
  sharedCount: number;
}

/**
 * Per-session aggregates the owner dashboard shows beside each couple:
 * when the gallery was first emailed and how often it was shared on.
 * Missing sessions map to zero/null; never throws.
 */
export async function galleryStatsForSessions(sessionIds: number[]): Promise<Map<number, SessionGalleryStats>> {
  const stats = new Map<number, SessionGalleryStats>();
  if (sessionIds.length === 0) return stats;
  try {
    const rows = await db
      .select({
        sessionId: galleryEventsTable.sessionId,
        emailedAt: sql<Date | null>`min(case when ${galleryEventsTable.eventType} = 'sent' then ${galleryEventsTable.createdAt} end)`,
        sharedCount: sql<number>`count(*) filter (where ${galleryEventsTable.eventType} = 'shared')::int`,
      })
      .from(galleryEventsTable)
      .where(inArray(galleryEventsTable.sessionId, sessionIds))
      .groupBy(galleryEventsTable.sessionId);
    for (const row of rows) {
      stats.set(row.sessionId, {
        emailedAt: row.emailedAt ? new Date(row.emailedAt) : null,
        sharedCount: Number(row.sharedCount ?? 0),
      });
    }
  } catch (err) {
    logger.warn({ err }, "gallery stats not loaded");
  }
  return stats;
}

/*
 * The single writer for gallery funnel events (shared-contract D6 / 4.3).
 * The recordGalleryEvent signature is frozen; the funnel workstream owns the
 * file and adds the stats helpers.
 */

export interface GalleryEventInput {
  sessionId: number;
  venueId: number;
  eventType: GalleryEventType;
  source?: GalleryEventSource | string | null;
  meta?: Record<string, unknown> | null;
  /** Salted viewer-IP hash (see hashClientIp); only used to dedupe repeat views. */
  ipHash?: string | null;
}

function ipHashSecret(): string {
  return (
    process.env.GALLERY_EVENT_IP_SALT ??
    process.env.UPLOAD_TOKEN_SECRET ??
    process.env.SESSION_SECRET ??
    "dreemer-gallery-events"
  );
}

/** Keyed, truncated hash of a client IP: good enough to dedupe, never reversible to the address. */
export function hashClientIp(ip: string | null | undefined): string | null {
  const value = ip?.trim();
  if (!value || value === "unknown") return null;
  return crypto.createHmac("sha256", ipHashSecret()).update(value).digest("base64url").slice(0, 24);
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Append one gallery event. Never throws.
 *
 * - "viewed": deduped per (session, ipHash) per UTC day when an ipHash is
 *   given; on a new view also sets couple_sessions.first_viewed_at once and
 *   bumps view_count (the KPI read path).
 * - "cta_click": bumps couple_sessions.cta_clicks.
 */
export async function recordGalleryEvent(input: GalleryEventInput): Promise<void> {
  try {
    if (input.eventType === "viewed" && input.ipHash) {
      const [seen] = await db
        .select({ id: galleryEventsTable.id })
        .from(galleryEventsTable)
        .where(
          and(
            eq(galleryEventsTable.sessionId, input.sessionId),
            eq(galleryEventsTable.eventType, "viewed"),
            eq(galleryEventsTable.ipHash, input.ipHash),
            gte(galleryEventsTable.createdAt, startOfUtcDay()),
          ),
        )
        .limit(1);
      if (seen) return;
    }

    await db.insert(galleryEventsTable).values({
      sessionId: input.sessionId,
      venueId: input.venueId,
      eventType: input.eventType,
      source: input.source ?? null,
      ipHash: input.ipHash ?? null,
      meta: input.meta ?? null,
    });

    if (input.eventType === "viewed") {
      await db
        .update(coupleSessionsTable)
        .set({
          firstViewedAt: sql`coalesce(${coupleSessionsTable.firstViewedAt}, now())`,
          viewCount: sql`${coupleSessionsTable.viewCount} + 1`,
        })
        .where(eq(coupleSessionsTable.id, input.sessionId));
    } else if (input.eventType === "cta_click") {
      await db
        .update(coupleSessionsTable)
        .set({ ctaClicks: sql`${coupleSessionsTable.ctaClicks} + 1` })
        .where(eq(coupleSessionsTable.id, input.sessionId));
    }
  } catch (err) {
    logger.warn({ err, sessionId: input.sessionId, eventType: input.eventType }, "gallery event not recorded");
  }
}
