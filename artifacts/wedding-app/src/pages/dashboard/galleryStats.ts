import type { SessionSummary } from "@workspace/api-client-react";

/**
 * Pure helpers for the gallery list and the venue's proof row: the status
 * vocabulary couples never see, the per-couple funnel (sent → viewed →
 * clicked date → booked), and month formatting. No React, no network.
 */

export type GalleryStage = "queued" | "rendering" | "ready" | "failed";

export function galleryStage(status: string): GalleryStage {
  switch (status) {
    case "pending":
      return "queued";
    case "processing":
      return "rendering";
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

export function stageLabel(stage: GalleryStage): string {
  switch (stage) {
    case "queued":
      return "Queued";
    case "rendering":
      return "Rendering";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
  }
}

export function sourceLabel(createdVia: string | null | undefined, kind: string | null | undefined): string {
  if (kind === "sample") return "Sample";
  switch (createdVia) {
    case "tour_day":
      return "Tour day";
    case "sample":
      return "Sample";
    default:
      return "Couple link";
  }
}

export interface FunnelChip {
  key: "sent" | "viewed" | "clicked" | "booked";
  label: string;
  done: boolean;
  /** Short note, e.g. "3 views" or "Jun 12". */
  detail: string | null;
}

type FunnelInput = Pick<
  SessionSummary,
  "emailedAt" | "firstViewedAt" | "viewCount" | "ctaClicks" | "bookedAt" | "sharedCount"
>;

export function sessionFunnel(session: FunnelInput, now: Date = new Date()): FunnelChip[] {
  const views = session.viewCount ?? 0;
  const clicks = session.ctaClicks ?? 0;
  const shares = session.sharedCount ?? 0;
  return [
    {
      key: "sent",
      label: "Sent",
      done: Boolean(session.emailedAt),
      detail: session.emailedAt ? shortDate(session.emailedAt, now) : null,
    },
    {
      key: "viewed",
      label: "Viewed",
      done: views > 0 || Boolean(session.firstViewedAt),
      detail:
        views > 0
          ? `${views} ${views === 1 ? "view" : "views"}${shares > 0 ? `, shared ${shares}` : ""}`
          : null,
    },
    {
      key: "clicked",
      label: "Clicked date",
      done: clicks > 0,
      detail: clicks > 0 ? `${clicks} ${clicks === 1 ? "click" : "clicks"}` : null,
    },
    {
      key: "booked",
      label: "Booked",
      done: Boolean(session.bookedAt),
      detail: session.bookedAt ? shortDate(session.bookedAt, now) : null,
    },
  ];
}

export interface GallerySummary {
  total: number;
  couples: number;
  ready: number;
  inProgress: number;
  failed: number;
  sent: number;
  viewed: number;
  clicked: number;
  booked: number;
  /** Booked ÷ ready couple galleries, 0-100, or null below two galleries. */
  bookedRate: number | null;
}

type SummaryInput = Pick<
  SessionSummary,
  "status" | "kind" | "emailedAt" | "firstViewedAt" | "viewCount" | "ctaClicks" | "bookedAt"
>;

export function summarizeGalleries(sessions: ReadonlyArray<SummaryInput>): GallerySummary {
  const couples = sessions.filter((s) => s.kind !== "sample");
  const ready = couples.filter((s) => s.status === "ready");
  const booked = couples.filter((s) => Boolean(s.bookedAt)).length;
  return {
    total: sessions.length,
    couples: couples.length,
    ready: ready.length,
    inProgress: couples.filter((s) => s.status === "pending" || s.status === "processing").length,
    failed: couples.filter((s) => s.status === "failed").length,
    sent: couples.filter((s) => Boolean(s.emailedAt)).length,
    viewed: couples.filter((s) => (s.viewCount ?? 0) > 0 || Boolean(s.firstViewedAt)).length,
    clicked: couples.filter((s) => (s.ctaClicks ?? 0) > 0).length,
    booked,
    bookedRate: ready.length >= 2 ? Math.round((booked / ready.length) * 100) : null,
  };
}

/** "2027-06" → "June 2027"; anything else → null. */
export function formatWeddingMonth(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** The default month option for a tour-day form: next month onwards, two years out. */
export function upcomingMonths(count = 24, now: Date = new Date()): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ value, label: formatWeddingMonth(value) ?? value });
  }
  return out;
}

/** "Jun 12" this year, "Jun 12, 2025" otherwise; empty for bad input. */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const sameYear = d.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

/** Owner-facing quality note from the owner session detail. */
export function qualityNote(
  summary: { belowTarget: boolean; attempts: number } | null | undefined,
): string | null {
  if (!summary || !summary.belowTarget) return null;
  const attempts = summary.attempts > 0 ? ` after ${summary.attempts} ${summary.attempts === 1 ? "attempt" : "attempts"}` : "";
  return `Below our quality target${attempts}. Preview before sending.`;
}
