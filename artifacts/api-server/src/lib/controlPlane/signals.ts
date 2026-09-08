import { eq } from "drizzle-orm";
import {
  db,
  venuesTable,
  controlPlaneSignalsTable,
  controlPlaneTicketsTable,
} from "@workspace/db";
import { logger } from "../logger.js";
import { isControlPlaneReady } from "./schemaGuard.js";

/**
 * The signal bus. Product code calls these from the paths it already runs —
 * a gallery failing, a venue signing up — and they must never change that
 * path's behaviour. Every function here swallows its own errors: telemetry
 * that can break a couple's gallery is worse than no telemetry.
 */

export type SignalSeverity = "info" | "warning" | "critical";

export interface SignalInput {
  organizationId: number | null;
  venueId?: number | null;
  kind: string;
  severity?: SignalSeverity;
  source?: string;
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
}

export async function recordSignal(input: SignalInput): Promise<void> {
  try {
    if (!(await isControlPlaneReady())) return;
    await db.insert(controlPlaneSignalsTable).values({
      organizationId: input.organizationId,
      venueId: input.venueId ?? null,
      kind: input.kind,
      severity: input.severity ?? "info",
      source: input.source ?? "product",
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      title: input.title,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    });
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "Could not record control plane signal");
  }
}

/** Resolve the owning organisation for a venue, for signals raised deep in the pipeline. */
export async function organizationIdForVenue(venueId: number): Promise<number | null> {
  try {
    const [venue] = await db
      .select({ organizationId: venuesTable.organizationId })
      .from(venuesTable)
      .where(eq(venuesTable.id, venueId));
    return venue?.organizationId ?? null;
  } catch (err) {
    logger.warn({ err, venueId }, "Could not resolve organization for venue");
    return null;
  }
}

export async function signalSessionFailed(
  venueId: number,
  sessionId: number,
  errorMessage: string | null,
): Promise<void> {
  const organizationId = await organizationIdForVenue(venueId);
  await recordSignal({
    organizationId,
    venueId,
    kind: "session.failed",
    severity: "warning",
    subjectType: "session",
    subjectId: String(sessionId),
    title: `Gallery #${sessionId} failed`,
    payload: { errorMessage },
  });
}

export async function signalSessionReady(
  venueId: number,
  sessionId: number,
  minutesToReady: number | null,
): Promise<void> {
  const organizationId = await organizationIdForVenue(venueId);
  await recordSignal({
    organizationId,
    venueId,
    kind: "session.ready",
    subjectType: "session",
    subjectId: String(sessionId),
    title: `Gallery #${sessionId} delivered`,
    payload: { minutesToReady },
  });
}

export async function signalVenueCreated(
  organizationId: number | null,
  venueId: number,
  venueName: string,
): Promise<void> {
  await recordSignal({
    organizationId,
    venueId,
    kind: "venue.created",
    subjectType: "venue",
    subjectId: String(venueId),
    title: `Venue ${venueName} joined`,
  });
}

export async function signalBillingEvent(
  organizationId: number,
  kind: string,
  title: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await recordSignal({
    organizationId,
    kind: `billing.${kind}`,
    source: "stripe",
    subjectType: "organization",
    subjectId: String(organizationId),
    title,
    payload,
  });
}

export interface TicketInput {
  organizationId: number;
  venueId?: number | null;
  sessionId?: number | null;
  source?: string;
  requesterEmail?: string | null;
  requesterName?: string | null;
  subject: string;
  body: string;
}

/**
 * Open a support ticket. Deliberately untriaged on arrival — the support
 * agent classifies it on its next tick, so classification is auditable
 * rather than buried in the intake path.
 */
export async function createTicket(input: TicketInput): Promise<number | null> {
  try {
    if (!(await isControlPlaneReady())) return null;
    const [row] = await db
      .insert(controlPlaneTicketsTable)
      .values({
        organizationId: input.organizationId,
        venueId: input.venueId ?? null,
        sessionId: input.sessionId ?? null,
        source: input.source ?? "web",
        requesterEmail: input.requesterEmail ?? null,
        requesterName: input.requesterName ?? null,
        subject: input.subject.slice(0, 300),
        body: input.body.slice(0, 8000),
      })
      .returning({ id: controlPlaneTicketsTable.id });

    await recordSignal({
      organizationId: input.organizationId,
      venueId: input.venueId ?? null,
      kind: "support.ticket_opened",
      subjectType: "ticket",
      subjectId: String(row?.id ?? ""),
      title: input.subject.slice(0, 200),
    });
    return row?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "Could not create support ticket");
    return null;
  }
}
