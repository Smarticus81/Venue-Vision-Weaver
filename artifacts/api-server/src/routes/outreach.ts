import { Router, type IRouter, type Request, type Response } from "express";
import { BRAND, BRAND_COLORS, BRAND_TYPE } from "@workspace/brand";
import { rateLimit, clientKey } from "../lib/rateLimit.js";
import { logger } from "../lib/logger.js";
import { findUnsubscribeTarget, unsubscribeByToken } from "../control-plane/outreach/unsubscribe.js";
import { escapeHtml } from "../control-plane/outreach/emailTemplate.js";
import { resolveClaim } from "../control-plane/outreach/claim.js";

/**
 * Public, unauthenticated outreach endpoints: the claim-link resolver that
 * pre-fills signup from the email a venue received, and unsubscribe.
 *
 * GET shows a one-button confirmation page (so link scanners cannot opt a
 * recipient out by prefetching), the form POST performs the opt-out, and the
 * RFC 8058 one-click POST (List-Unsubscribe-Post: List-Unsubscribe=One-Click)
 * performs it with no page at all. Every path lands in the suppression list.
 */

const router: IRouter = Router();

function page(title: string, body: string, status = 200): { status: number; html: string } {
  const light = BRAND_COLORS.light;
  const dark = BRAND_COLORS.dark;
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)} · ${escapeHtml(BRAND.name)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: ${light.canvas}; color: ${light.ink}; font-family: ${BRAND_TYPE.body}; }
    main { width: min(440px, calc(100% - 32px)); background: ${light.surface}; border: 1px solid ${light.border}; border-radius: 10px; padding: 32px; }
    h1 { font-family: ${BRAND_TYPE.display}; font-weight: 400; font-size: 26px; margin: 0 0 12px; letter-spacing: -0.02em; }
    p { margin: 0 0 16px; line-height: 1.6; font-size: 15px; }
    .muted { color: ${light.inkMuted}; font-size: 13px; }
    button { min-height: 44px; padding: 0 20px; border: 0; border-radius: 6px; background: ${light.accent}; color: ${light.onAccent}; font: inherit; font-weight: 600; cursor: pointer; }
    button:hover { background: ${light.accentHover}; }
    .brand { display: inline-flex; align-items: center; gap: 8px; color: ${light.inkMuted}; font-size: 14px; margin-bottom: 20px; }
    @media (prefers-color-scheme: dark) {
      body { background: ${dark.canvas}; color: ${dark.ink}; }
      main { background: ${dark.surface}; border-color: ${dark.border}; }
      .muted, .brand { color: ${dark.inkMuted}; }
      button { background: ${dark.accent}; color: ${dark.onAccent}; }
      button:hover { background: ${dark.accentHover}; }
    }
  </style>
</head>
<body>
  <main>
    <div class="brand">${escapeHtml(BRAND.wordmark)}</div>
    ${body}
  </main>
</body>
</html>`,
  };
}

function send(res: Response, rendered: { status: number; html: string }): void {
  res.status(rendered.status).setHeader("Cache-Control", "no-store").type("html").send(rendered.html);
}

function limited(req: Request, res: Response): boolean {
  if (rateLimit(`unsubscribe:${clientKey(req)}`, 60, 60 * 60 * 1000)) return false;
  send(res, page("Too many requests", `<h1>Please try again shortly</h1><p class="muted">Too many requests from this network.</p>`, 429));
  return true;
}

router.get("/outreach/unsubscribe/:token", async (req, res): Promise<void> => {
  if (limited(req, res)) return;
  const token = String(req.params.token ?? "");
  const target = await findUnsubscribeTarget(token).catch((err) => {
    logger.warn({ err }, "Unsubscribe lookup failed");
    return null;
  });
  if (!target) {
    send(res, page("Link not recognized", `<h1>This link is not recognized</h1><p>It may have been copied incompletely. Reply to the original email and we will remove you by hand.</p>`, 404));
    return;
  }
  send(
    res,
    page(
      "Unsubscribe",
      `<h1>Stop hearing from ${escapeHtml(BRAND.name)}?</h1>
       <p>Confirm and we will not email <strong>${escapeHtml(target.venueName)}</strong> at this address again.</p>
       <form method="post" action="/api/outreach/unsubscribe/${encodeURIComponent(token)}">
         <input type="hidden" name="confirm" value="1" />
         <button type="submit">Unsubscribe</button>
       </form>
       <p class="muted" style="margin-top:20px;">No sign-in needed. This takes effect immediately.</p>`,
    ),
  );
});

router.post("/outreach/unsubscribe/:token", async (req, res): Promise<void> => {
  if (limited(req, res)) return;
  const token = String(req.params.token ?? "");
  const body = (req.body ?? {}) as Record<string, unknown>;
  const oneClick =
    body["List-Unsubscribe"] === "One-Click" ||
    (typeof req.headers["content-type"] === "string" && /text\/plain/.test(req.headers["content-type"]) && String(body).includes("One-Click"));

  let target = null;
  try {
    target = await unsubscribeByToken(token, oneClick ? "one_click" : "unsubscribe_link");
  } catch (err) {
    logger.error({ err }, "Unsubscribe failed");
    if (oneClick) {
      res.status(500).end();
      return;
    }
    send(res, page("Something went wrong", `<h1>Something went wrong</h1><p>Reply to the original email and we will remove you by hand.</p>`, 500));
    return;
  }

  if (oneClick) {
    // Mail clients only look at the status code.
    res.status(target ? 200 : 404).end();
    return;
  }
  if (!target) {
    send(res, page("Link not recognized", `<h1>This link is not recognized</h1><p>Reply to the original email and we will remove you by hand.</p>`, 404));
    return;
  }
  send(
    res,
    page(
      "Unsubscribed",
      `<h1>You are unsubscribed</h1>
       <p>We will not email <strong>${escapeHtml(target.venueName)}</strong> at this address again. Sorry for the interruption, and thank you for letting us know.</p>
       <p class="muted">${escapeHtml(BRAND.name)} · ${escapeHtml(BRAND.domain)}</p>`,
    ),
  );
});

// GET /outreach/claim/{token} — the venue an outreach email was written for (pre-fills signup).
// Only sent emails resolve; the first resolution stamps the email's clickedAt.
router.get("/outreach/claim/:token", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  if (!rateLimit(`outreach-claim:${clientKey(req)}`, 60, 60 * 60 * 1000)) {
    res.status(429).json({ error: "Too many requests; try again shortly." });
    return;
  }
  try {
    const claim = await resolveClaim(String(req.params.token ?? ""));
    if (!claim) {
      res.status(404).json({ error: "This claim link is not recognized." });
      return;
    }
    res.json(claim);
  } catch (err) {
    logger.error({ err }, "Outreach claim lookup failed");
    res.status(500).json({ error: "Could not load this claim link." });
  }
});

export default router;
