import { db, funnelEventsTable, FUNNEL_EVENTS, type FunnelEvent } from "@workspace/db";
import { logger } from "./logger.js";

/*
 * Owner-funnel event log (funnel_events). Written by the public site through
 * POST /api/events, by the billing webhook, the venue routes and the gallery
 * pipeline. Never throws: analytics must not break a request.
 */

export type { FunnelEvent };

export interface FunnelEventInput {
  organizationId?: number | null;
  venueId?: number | null;
  event: FunnelEvent | string;
  properties?: Record<string, unknown> | null;
  /** web | server | stripe | control_plane ... */
  source?: string | null;
}

export function isFunnelEvent(value: unknown): value is FunnelEvent {
  return typeof value === "string" && (FUNNEL_EVENTS as readonly string[]).includes(value);
}

export async function recordFunnelEvent(input: FunnelEventInput): Promise<void> {
  try {
    await db.insert(funnelEventsTable).values({
      organizationId: input.organizationId ?? null,
      venueId: input.venueId ?? null,
      event: input.event,
      properties: input.properties ?? null,
      source: input.source ?? null,
    });
  } catch (err) {
    logger.warn({ err, event: input.event, organizationId: input.organizationId ?? null }, "funnel event not recorded");
  }
}
