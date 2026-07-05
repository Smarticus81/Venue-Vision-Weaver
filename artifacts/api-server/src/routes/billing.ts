import { Router, type IRouter, type Request, type Response } from "express";
import { Webhook } from "svix";
import { desc, eq } from "drizzle-orm";
import {
  db,
  organizationsTable,
  venuesTable,
  creditTransactionsTable,
  STARTER_MONTHLY_CREDITS,
  GROWTH_MONTHLY_CREDITS,
  type OrgPlan,
} from "@workspace/db";
import {
  grantCreditsToOrg,
  setOrgCreditsBalance,
} from "../lib/credits.js";
import { requireOrg, ensureOrganizationByClerkId } from "../lib/orgAuth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const PLAN_CREDITS: Record<string, number> = {
  starter: STARTER_MONTHLY_CREDITS,
  growth: GROWTH_MONTHLY_CREDITS,
};

/** Map a Clerk Billing plan slug onto our plan enum, ignoring free tiers. */
function paidPlanFromSlug(slug: string | undefined | null): OrgPlan | null {
  if (!slug) return null;
  const normalized = slug.toLowerCase();
  if (normalized.includes("growth")) return "growth";
  if (normalized.includes("starter")) return "starter";
  return null;
}

/* ————— Org billing summary (dashboard) ————— */

// GET /org — the caller's organization: plan, credits, and its venues.
router.get("/org", async (req, res): Promise<void> => {
  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  const venues = await db
    .select({
      id: venuesTable.id,
      name: venuesTable.name,
      slug: venuesTable.slug,
      tagline: venuesTable.tagline,
      createdAt: venuesTable.createdAt,
    })
    .from(venuesTable)
    .where(eq(venuesTable.organizationId, ctx.org.id))
    .orderBy(venuesTable.createdAt);

  res.json({
    organization: {
      id: ctx.org.id,
      name: ctx.org.name,
      plan: ctx.org.plan,
      creditsBalance: ctx.org.creditsBalance,
      billingPeriodEnd: ctx.org.billingPeriodEnd,
      clerkOrgId: ctx.org.clerkOrgId,
      role: ctx.orgRole,
    },
    venues,
  });
});

// GET /org/credit-history — recent ledger rows for the caller's organization.
router.get("/org/credit-history", async (req, res): Promise<void> => {
  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  const rows = await db
    .select({
      id: creditTransactionsTable.id,
      delta: creditTransactionsTable.delta,
      reason: creditTransactionsTable.reason,
      venueId: creditTransactionsTable.venueId,
      sessionId: creditTransactionsTable.sessionId,
      createdAt: creditTransactionsTable.createdAt,
    })
    .from(creditTransactionsTable)
    .where(eq(creditTransactionsTable.organizationId, ctx.org.id))
    .orderBy(desc(creditTransactionsTable.createdAt))
    .limit(50);

  res.json({ transactions: rows });
});

/* ————— Clerk webhook (auth + billing events) ————— */

type ClerkSubscriptionItem = {
  status?: string;
  plan?: { slug?: string; name?: string };
  period_end?: number | null;
  periodEnd?: number | null;
};

type ClerkWebhookEvent = {
  type: string;
  data: {
    id?: string;
    name?: string;
    slug?: string;
    status?: string;
    payer?: { organization_id?: string | null; user_id?: string | null };
    items?: ClerkSubscriptionItem[];
    plan?: { slug?: string; name?: string };
    period_end?: number | null;
    organization?: { id?: string };
  };
};

function timestampToDate(value: number | null | undefined): Date | null {
  if (!value || !Number.isFinite(value)) return null;
  // Clerk sends epoch milliseconds; tolerate seconds just in case.
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms);
}

async function applyPlanChange(
  clerkOrgId: string,
  plan: OrgPlan,
  eventKey: string,
  periodEnd: Date | null,
): Promise<void> {
  const org = await ensureOrganizationByClerkId(clerkOrgId);

  await db
    .update(organizationsTable)
    .set({ plan, billingPeriodEnd: periodEnd })
    .where(eq(organizationsTable.id, org.id));

  const monthly = PLAN_CREDITS[plan];
  if (monthly) {
    await setOrgCreditsBalance(org.id, monthly, "subscription_grant", eventKey);
    logger.info({ clerkOrgId, plan, monthly }, "Applied subscription credit grant");
  }
}

async function handleSubscriptionEvent(event: ClerkWebhookEvent, eventKey: string): Promise<void> {
  const clerkOrgId = event.data.payer?.organization_id ?? null;
  if (!clerkOrgId) {
    // User-level (B2C) subscriptions are not part of this product.
    logger.info({ type: event.type }, "Ignoring non-organization billing event");
    return;
  }

  const items: ClerkSubscriptionItem[] = Array.isArray(event.data.items)
    ? event.data.items
    : event.data.plan
      ? [{ plan: event.data.plan, status: event.data.status, period_end: event.data.period_end }]
      : [];

  // Prefer an active paid item; otherwise detect that paid coverage ended.
  const activePaid = items.find(
    (item) => paidPlanFromSlug(item.plan?.slug) && (item.status ?? "active") === "active",
  );

  if (activePaid) {
    const plan = paidPlanFromSlug(activePaid.plan?.slug)!;
    const periodEnd = timestampToDate(activePaid.period_end ?? activePaid.periodEnd);
    await applyPlanChange(clerkOrgId, plan, eventKey, periodEnd);
    return;
  }

  const hadPaidItem = items.some((item) => paidPlanFromSlug(item.plan?.slug));
  const subscriptionEnded =
    event.type === "subscription.canceled" ||
    event.type === "subscriptionItem.canceled" ||
    event.type === "subscriptionItem.ended" ||
    event.data.status === "canceled" ||
    event.data.status === "ended";

  if (hadPaidItem && subscriptionEnded) {
    const org = await ensureOrganizationByClerkId(clerkOrgId);
    await db
      .update(organizationsTable)
      .set({ plan: "none", billingPeriodEnd: null })
      .where(eq(organizationsTable.id, org.id));
    logger.info({ clerkOrgId }, "Subscription ended; organization set to plan none");
  }
}

export async function handleClerkWebhook(req: Request, res: Response): Promise<void> {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    res.status(503).send("Clerk webhook secret not configured");
    return;
  }

  const svixId = req.headers["svix-id"];
  const svixTimestamp = req.headers["svix-timestamp"];
  const svixSignature = req.headers["svix-signature"];
  if (
    typeof svixId !== "string" ||
    typeof svixTimestamp !== "string" ||
    typeof svixSignature !== "string"
  ) {
    res.status(400).send("Missing svix headers");
    return;
  }

  const payload = req.body instanceof Buffer ? req.body.toString("utf8") : "";
  let event: ClerkWebhookEvent;
  try {
    const webhook = new Webhook(secret);
    event = webhook.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    logger.warn({ err }, "Clerk webhook signature verification failed");
    res.status(400).send("Invalid signature");
    return;
  }

  try {
    if (event.type.startsWith("subscription")) {
      // svix-id is stable across redeliveries of the same message — our
      // idempotency key for credit grants.
      await handleSubscriptionEvent(event, svixId);
    } else if (event.type === "organization.created" || event.type === "organization.updated") {
      const clerkOrgId = event.data.id;
      const name = event.data.name;
      if (clerkOrgId) {
        const org = await ensureOrganizationByClerkId(clerkOrgId, name);
        if (name && name !== org.name) {
          await db
            .update(organizationsTable)
            .set({ name })
            .where(eq(organizationsTable.id, org.id));
        }
      }
    }
  } catch (err) {
    logger.error({ err, type: event.type }, "Clerk webhook handler error");
    res.status(500).send("Webhook handler failed");
    return;
  }

  res.json({ received: true });
}

export { grantCreditsToOrg };
export default router;
