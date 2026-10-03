import { defineConfig, mergeConfig } from "vite";
import config from "../vite.config";
import path from "node:path";
import fs from "node:fs";
const media = Array.from({ length: 1 }, (_, i) => ({
  id: i + 1,
  objectKey: "/demo" + i,
  coverage: ["exterior", "ceremony", "reception", "detail", "wide"][i],
}));
const venue = {
  id: 1,
  name: "The Willow House",
  slug: "willow",
  description: "A garden setting for a day that feels entirely yours.",
  contactEmail: "team@example.test",
  ownerEmail: "team@example.test",
  bookingUrl: "https://example.test/tours",
  media,
  isReady: true,
};
const controlOverview = {
  operatorEmail: "operator@example.test",
  aiConfigured: true,
  model: "grok-4.7",
  metrics: {
    capturedAt: new Date().toISOString(),
    organizations: { total: 14, byPlan: { trial: 9, starter: 4, growth: 1 }, totalCreditsBalance: 212, lowCreditCount: 3, paidCount: 5 },
    venues: { total: 19, new7d: 2, new30d: 6, withMedia: 15, withSessions: 11, unadoptedLegacy: 1, activationRate: 57.9 },
    sessions: { total: 143, byStatus: { ready: 128, processing: 3, failed: 12 }, created7d: 21, created30d: 64, ready7d: 19, failed7d: 2, failureRate7d: 9.5, avgCompletionMinutes7d: 4.2 },
    credits: { granted30d: 160, consumed30d: 64, refunded30d: 2, purchased30d: 90, grantsByReason30d: { purchase: 90, trial: 45, subscription: 25 } },
    assets: { generated7d: 95 },
  },
  agents: [
    ["prospecting", "Prospecting", "prospecting", "Finds and scores venue prospects from public sources."],
    ["outreach", "Outreach", "outreach", "Drafts first-touch and follow-up emails for operator approval."],
    ["campaigns", "Campaigns", "campaigns", "Runs multi-step sequences and reports the funnel."],
    ["support", "Support", "support", "Watches failed sessions and venue questions."],
    ["product", "Product repair", "product", "Flags generation quality regressions."],
    ["finance", "Finance", "finance", "Tracks credits, plans, and revenue."],
  ].map(([key, name, domain, description], i) => ({
    key, name, domain, description,
    status: i === 3 ? "paused" : "active",
    intervalMinutes: 360,
    lastRunAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
    lastRunStatus: i === 4 ? "failed" : "succeeded",
  })),
  counts: { pendingActions: 4, openTasks: 7, runningExperiments: 2, runs24h: 18 },
};
const session = {
  id: 1,
  shareToken: "demo",
  coupleName: "Alex & Jordan",
  coupleEmail: "couple@example.test",
  status: "ready",
  createdAt: new Date().toISOString(),
  venue,
  generatedAssets: Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    assetType: "image",
    objectKey: "/demo" + i,
    displayOrder: i,
  })),
};
const qaConfig = mergeConfig(config, {
  define: {
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY":
      JSON.stringify("pk_test_Zml4dHVyZS5jbGVyay5hY2NvdW50cy5kZXYk"),
  },
  resolve: {
    alias: {
      "@clerk/clerk-react": path.resolve(
        import.meta.dirname,
        "clerk-fixture.tsx",
      ),
    },
  },
  server: { port: 8082, proxy: {} },
  plugins: [
    {
      name: "isolated-ui-fixtures",
      configureServer(server) {
        server.middlewares.use("/api", (req, res) => {
          res.setHeader("Content-Type", "application/json");
          let u = req.url || "";
          if (u.startsWith("/storage")) {
            res.setHeader("Content-Type", "image/webp");
            res.end(
              fs.readFileSync(
                path.resolve(
                  import.meta.dirname,
                  "../public/brand/garden-venue.webp",
                ),
              ),
            );
            return;
          }
          if (req.method !== "GET") {
            res.statusCode = 503;
            res.end(
              JSON.stringify({
                error: "Fixture: service unavailable. Please try again.",
              }),
            );
            return;
          }
          let data;
          if (u.startsWith("/control/overview")) data = controlOverview;
          else if (u === "/org")
            data = {
              organization: {
                id: 1,
                name: "Willow House",
                creditsBalance: 12,
                plan: "starter",
              },
              venues: [venue],
            };
          else if (u.endsWith("/dashboard"))
            data = { venue, sessions: [session] };
          else if (u.endsWith("/media")) data = { media };
          else if (u.startsWith("/venues/willow")) data = venue;
          else if (u.startsWith("/gallery-styles"))
            data = {
              styles: [
                {
                  id: "garden",
                  name: "Garden romance",
                  description:
                    "Natural light, soft florals, and a relaxed celebration.",
                },
                {
                  id: "classic",
                  name: "Timeless celebration",
                  description:
                    "Clean compositions and an elegant wedding-day mood.",
                },
              ],
            };
          else if (u.startsWith("/sessions/by-token/processing"))
            data = { ...session, status: "processing" };
          else if (u.startsWith("/sessions/by-token/failed"))
            data = { ...session, status: "failed", generatedAssets: [] };
          else if (u.startsWith("/sessions/by-token/")) data = session;
          else {
            res.statusCode = 404;
            data = { error: "Fixture not found" };
          }
          res.end(JSON.stringify(data));
        });
      },
    },
  ],
});

qaConfig.server = {
  ...qaConfig.server,
  host: "127.0.0.1",
  port: 8082,
  proxy: undefined,
};
export default defineConfig(({ command }) => {
  if (command !== "serve") throw new Error("UI fixtures are development-only and cannot be built for deployment.");
  return qaConfig;
});
