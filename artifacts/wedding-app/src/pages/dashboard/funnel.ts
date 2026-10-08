import { recordFunnelEvent, type FunnelEventBodyEvent } from "@workspace/api-client-react";

/**
 * Fire-and-forget owner-funnel events from the dashboard and signup. The
 * server attaches the organization from the session; the browser never sends
 * ids it could lie about. Never throws, never blocks the UI.
 */
export type FunnelSource = "signup" | "dashboard" | "tour_day" | "billing";

const seenOnce = new Set<string>();

export function trackFunnel(
  event: FunnelEventBodyEvent,
  properties?: Record<string, unknown>,
  source: FunnelSource = "dashboard",
): void {
  try {
    void recordFunnelEvent({ event, properties, source }).catch(() => {});
  } catch {
    // The analytics path must never surface to the owner.
  }
}

/** Like trackFunnel, but at most once per page load per key. */
export function trackFunnelOnce(
  key: string,
  event: FunnelEventBodyEvent,
  properties?: Record<string, unknown>,
  source: FunnelSource = "dashboard",
): void {
  if (seenOnce.has(key)) return;
  seenOnce.add(key);
  trackFunnel(event, properties, source);
}
