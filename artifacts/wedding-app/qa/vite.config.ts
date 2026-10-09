import { defineConfig, mergeConfig } from "vite";
import config from "../vite.config";
import path from "node:path";
import fs from "node:fs";
import { controlFixture } from "./control-fixture";

/*
 * Fixture payloads mirror the generated API types (lib/api-client-react
 * src/generated/api.schemas.ts). Every name, email and number is invented.
 */
const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();
const daysAhead = (days: number) => new Date(now + days * 86_400_000).toISOString();

// Six venue photos covering every required view (VenueMediaItem).
const media = (
  ["exterior", "ceremony", "reception", "detail", "natural_light", "exterior"] as const
).map((coverage, i) => ({
  id: i + 1,
  venueId: 1,
  objectKey: `/objects/uploads/venue-${i + 1}`,
  coverage,
  displayOrder: i,
  createdAt: daysAgo(20 - i),
}));

const venueProfile = {
  id: 1,
  name: "The Willow House",
  slug: "willow",
  tagline: "Garden weddings under the old willow",
  description: "A garden setting for a day that feels entirely yours.",
  contactEmail: "team@example.test",
  contactPhone: "555-0100",
  websiteUrl: "https://example.test/",
  bookingUrl: "https://example.test/tours",
  incentiveText: "Book a tour this month and we'll add a free tasting.",
  reviewBeforeSend: false,
  createdAt: daysAgo(30),
};

// Owner view (VenueResponse): billing numbers come from the organization.
const ownerVenue = {
  ...venueProfile,
  ownerEmail: "team@example.test",
  organizationId: 1,
  tourCardDownloadedAt: null,
  websiteImportedAt: null,
  plan: "trial",
  creditsBalance: 3,
  billingPeriodEnd: null,
};

// Couple view (VenuePublicResponse).
const publicVenue = {
  ...venueProfile,
  media,
  isReady: true,
  bookingReady: true,
  turnstileSiteKey: null,
  missingCoverages: [],
  uploadToken: "fixture-upload-token",
};

const sessionBase = {
  venueId: 1,
  styleId: "garden",
  kind: "couple",
  createdVia: "couple_link",
  weddingMonth: "2027-06",
  createdAt: daysAgo(2),
};

// Public gallery (SessionDetailResponse): four stills at displayOrder 1..4.
const session = {
  ...sessionBase,
  id: 1,
  shareToken: "demo",
  coupleName: "Alex & Jordan",
  hasCoupleEmail: true,
  status: "ready",
  completedAt: daysAgo(2),
  venue: publicVenue,
  generatedAssets: Array.from({ length: 4 }, (_, i) => ({
    id: i + 1,
    sessionId: 1,
    assetType: "image",
    objectKey: `/objects/generated/demo-${i + 1}`,
    displayOrder: i + 1,
  })),
};

// Dashboard rows (SessionSummary): one of each state the gallery list shows.
const sessionSummaries = [
  {
    ...sessionBase,
    id: 1,
    status: "ready",
    completedAt: daysAgo(2),
    thumbnailObjectKey: "/objects/generated/demo-1",
    coupleName: "Alex & Jordan",
    coupleEmail: "couple@example.test",
    shareToken: "demo",
    emailedAt: daysAgo(2),
    firstViewedAt: daysAgo(1),
    viewCount: 7,
    sharedCount: 2,
    ctaClicks: 1,
    bookedAt: null,
  },
  {
    ...sessionBase,
    id: 2,
    status: "ready",
    createdVia: "tour_day",
    createdAt: daysAgo(9),
    completedAt: daysAgo(9),
    thumbnailObjectKey: "/objects/generated/demo-2",
    coupleName: "Sam & Riley",
    coupleEmail: "sam@example.test",
    shareToken: "demo-booked",
    emailedAt: daysAgo(9),
    firstViewedAt: daysAgo(8),
    viewCount: 12,
    sharedCount: 4,
    ctaClicks: 3,
    bookedAt: daysAgo(3),
  },
  {
    ...sessionBase,
    id: 3,
    status: "processing",
    createdAt: daysAgo(0),
    coupleName: "Morgan & Casey",
    coupleEmail: "morgan@example.test",
    shareToken: "processing",
    viewCount: 0,
    sharedCount: 0,
    ctaClicks: 0,
  },
  {
    ...sessionBase,
    id: 4,
    status: "failed",
    createdAt: daysAgo(4),
    coupleName: "Taylor & Quinn",
    coupleEmail: "taylor@example.test",
    shareToken: "failed",
    viewCount: 0,
    sharedCount: 0,
    ctaClicks: 0,
  },
];

// Owner session detail (OwnerSessionDetailResponse).
const ownerSessionDetail = (id: number) => {
  const summary = sessionSummaries.find((row) => row.id === id) ?? sessionSummaries[0]!;
  return {
    ...session,
    ...summary,
    hasCoupleEmail: true,
    venue: publicVenue,
    generatedAssets: summary.status === "ready" ? session.generatedAssets : [],
    consentAt: summary.createdAt,
    failureDetail: summary.status === "failed" ? "Fixture: the couple photos were too dark to judge." : null,
    qualitySummary: summary.status === "ready" ? { belowTarget: id === 2, attempts: id === 2 ? 9 : 4 } : null,
  };
};

// GET /org (OrganizationResponse): an admin on day 9 of the trial.
const organization = {
  id: 1,
  clerkOrgId: "org_fixture",
  name: "Willow House",
  plan: "trial",
  creditsBalance: 3,
  billingPeriodEnd: null,
  contactEmail: "team@example.test",
  firstPaidAt: null,
  churnedAt: null,
  shareAggregates: false,
  trial: { onTrial: true, endsAt: daysAhead(5), daysLeft: 5, expired: false, creditsRemaining: 3 },
  role: "org:admin",
  billingConfigured: true,
  subscriptionStatus: null,
  cancelAtPeriodEnd: false,
};

// GET /public/config (PublicConfig): the server's defaults with billing on.
const publicConfig = {
  pricing: {
    currency: "USD",
    label: "Launch prices",
    starterMonthly: 129,
    growthMonthly: 279,
    creditPack: 59,
    starterCredits: 25,
    growthCredits: 100,
    creditPackCredits: 10,
  },
  trial: { credits: 5, days: 14 },
  founding: { slotsLeft: 7, slotsTotal: 10 },
  proof: { mode: "partner" },
  contactEmail: "hello@example.test",
  billingConfigured: true,
  retentionDays: 30,
};

const creditHistory = {
  transactions: [
    { id: 3, delta: -1, reason: "session_debit", venueId: 1, sessionId: 2, createdAt: daysAgo(9) },
    { id: 2, delta: -1, reason: "session_debit", venueId: 1, sessionId: 1, createdAt: daysAgo(2) },
    { id: 1, delta: 5, reason: "trial_grant", venueId: null, sessionId: null, createdAt: daysAgo(30) },
  ],
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
          if (u.startsWith("/control") && req.method === "GET") {
            const fixture = controlFixture(u);
            if (fixture !== undefined) {
              res.end(JSON.stringify(fixture));
              return;
            }
          }
          if (u.startsWith("/storage")) {
            res.setHeader("Content-Type", "image/webp");
            res.end(
              fs.readFileSync(
                path.resolve(
                  import.meta.dirname,
                  "../public/brand/compare-room.webp",
                ),
              ),
            );
            return;
          }
          // Funnel and gallery tracking beacons are accepted and dropped.
          if (
            req.method === "POST" &&
            (u === "/events" || /^\/sessions\/by-token\/[^/]+\/events$/.test(u))
          ) {
            res.statusCode = 202;
            res.end(JSON.stringify({ recorded: true }));
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
          const route = u.split("?")[0] ?? u;
          if (route === "/org")
            data = {
              organization,
              venues: [
                { id: 1, name: venueProfile.name, slug: venueProfile.slug, tagline: venueProfile.tagline, createdAt: venueProfile.createdAt },
              ],
            };
          else if (route === "/org/credit-history") data = creditHistory;
          else if (route === "/public/config") data = publicConfig;
          else if (route.endsWith("/dashboard"))
            data = { venue: ownerVenue, sessions: sessionSummaries };
          else if (route.endsWith("/media")) data = { media };
          else if (route.startsWith("/venues/willow")) data = publicVenue;
          else if (/^\/sessions\/\d+$/.test(route))
            data = ownerSessionDetail(Number(route.split("/")[2]));
          else if (route.startsWith("/gallery-styles"))
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
          else if (route.startsWith("/sessions/by-token/processing"))
            data = { ...session, shareToken: "processing", status: "processing", completedAt: null, generatedAssets: [] };
          else if (route.startsWith("/sessions/by-token/failed"))
            data = {
              ...session,
              shareToken: "failed",
              status: "failed",
              completedAt: null,
              errorMessage:
                "We couldn't create a close enough likeness from these photos. Clear, sharp, well-lit photos where both faces are easy to see work best. Please try again with different photos.",
              generatedAssets: [],
            };
          else if (route.startsWith("/sessions/by-token/")) data = session;
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
