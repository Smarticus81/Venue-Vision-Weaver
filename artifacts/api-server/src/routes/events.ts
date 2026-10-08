import { Router, type IRouter } from "express";
import { RecordFunnelEventBody } from "@workspace/api-zod";
import { rateLimit, clientKey } from "../lib/rateLimit.js";
import { recordFunnelEvent } from "../lib/funnelEvents.js";
import { getCallerOrgDbId } from "../lib/orgAuth.js";

const router: IRouter = Router();

// Per-IP cap: 60 events per 10 minutes is far above a real visitor's pace.
const EVENTS_PER_WINDOW = 60;
const WINDOW_MS = 10 * 60 * 1000;

// POST /events — owner-funnel events from the public site and dashboard.
// Public, validated against the fixed enum, rate limited per IP, written to
// funnel_events; always 202 once accepted (analytics never block the caller).
router.post("/events", async (req, res): Promise<void> => {
  const body = RecordFunnelEventBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message, code: "invalid_event" });
    return;
  }

  if (!rateLimit(`events:${clientKey(req)}`, EVENTS_PER_WINDOW, WINDOW_MS)) {
    res.status(429).json({ error: "Too many events from this address. Try again later.", code: "rate_limited" });
    return;
  }

  // Attribute to the caller's organization when they are signed in; never
  // trust an organization id from the body.
  const organizationId = await getCallerOrgDbId(req).catch(() => null);

  await recordFunnelEvent({
    organizationId,
    event: body.data.event,
    properties: body.data.properties ?? null,
    source: body.data.source?.trim() || "web",
  });

  res.status(202).json({ accepted: true });
});

export default router;
