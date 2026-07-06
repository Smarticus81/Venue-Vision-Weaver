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
  CREDIT_PACK_AMOUNT,
  type Organization,
} from "@workspace/db";
import {
  grantCreditsToOrg,
  setOrgCreditsBalance,
} from "../lib/credits.js";
import {
  requireStripe,
  isStripeConfigured,
  STRIPE_PRICES,
  getAppBaseUrl,
  type BillingProduct,
} from "../lib/stripe.js";
import {
  requireOrg,
  requireOwnerMutationOrigin,
  ensureOrganizationByClerkId,
  fetchClerkUserEmail,
} from "../lib/orgAuth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ————— Org summary (dashboard) ————— */

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
      billingConfigured: isStripeConfigured(),
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

/* ————— Stripe billing (organization-scoped) ————— */

async function ensureStripeCustomer(org: Organization, clerkUserId: string): Promise<string> {
  const stripe = requireStripe();
  if (org.stripeCustomerId) return org.stripeCustomerId;

  // Only hit Clerk for the billing email on first-time customer creation.
  const billingEmail = await fetchClerkUserEmail(clerkUserId);
  const customer = await stripe.customers.create({
    email: billingEmail ?? undefined,
    name: org.name,
    metadata: { organizationId: String(org.id), clerkOrgId: org.clerkOrgId },
  });

  await db
    .update(organizationsTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(organizationsTable.id, org.id));

  return customer.id;
}

// POST /org/billing/checkout — start Stripe Checkout for the caller's org.
router.post("/org/billing/checkout", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Billing is not configured on this server." });
    return;
  }

  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  const product = req.body?.product as BillingProduct;
  if (!product || !(product in STRIPE_PRICES)) {
    res.status(400).json({ error: "product must be starter, growth, or credit_pack" });
    return;
  }

  const priceId = STRIPE_PRICES[product];
  if (!priceId) {
    res.status(503).json({ error: "Price not configured for this product" });
    return;
  }

  try {
    const stripe = requireStripe();
    const customerId = await ensureStripeCustomer(ctx.org, ctx.clerkUserId);
    const base = getAppBaseUrl();

    const isSubscription = product === "starter" || product === "growth";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/dashboard?billing=success`,
      cancel_url: `${base}/dashboard?billing=cancel`,
      metadata: {
        organizationId: String(ctx.org.id),
        product,
      },
      subscription_data: isSubscription
        ? { metadata: { organizationId: String(ctx.org.id), product } }
        : undefined,
    });

    if (!session.url) {
      res.status(500).json({ error: "Failed to create checkout session" });
      return;
    }

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, orgId: ctx.org.id, product }, "Stripe checkout failed");
    res.status(500).json({ error: "Could not start checkout" });
  }
});

// POST /org/billing/portal — open the Stripe customer portal for the org.
router.post("/org/billing/portal", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Billing is not configured on this server." });
    return;
  }

  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  try {
    const stripe = requireStripe();
    const customerId = await ensureStripeCustomer(ctx.org, ctx.clerkUserId);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppBaseUrl()}/dashboard`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    logger.error({ err, orgId: ctx.org.id }, "Stripe portal failed");
    res.status(500).json({ error: "Could not open billing portal" });
  }
});

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const stripe = requireStripe();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    res.status(503).send("Webhook secret not configured");
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).send("Missing stripe-signature");
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, webhookSecret);
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).send("Invalid signature");
    return;
  }

  try {
    const [existingEvent] = await db
      .select({ id: creditTransactionsTable.id })
      .from(creditTransactionsTable)
      .where(eq(creditTransactionsTable.stripeEventId, event.id))
      .limit(1);
    if (existingEvent) {
      res.json({ received: true });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const organizationId = Number(session.metadata?.organizationId);
        const product = session.metadata?.product as BillingProduct | undefined;
        if (!organizationId || !product) break;

        if (product === "credit_pack") {
          await grantCreditsToOrg(organizationId, CREDIT_PACK_AMOUNT, "pack_purchase", event.id);
        } else if (product === "starter" || product === "growth") {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;
          await db
            .update(organizationsTable)
            .set({
              plan: product,
              stripeSubscriptionId: subId ?? null,
            })
            .where(eq(organizationsTable.id, organizationId));
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const subId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id;
        if (!subId) break;

        const [org] = await db
          .select()
          .from(organizationsTable)
          .where(eq(organizationsTable.stripeSubscriptionId, subId));
        if (!org) break;

        const credits =
          org.plan === "growth" ? GROWTH_MONTHLY_CREDITS : STARTER_MONTHLY_CREDITS;
        await setOrgCreditsBalance(org.id, credits, "subscription_grant", event.id);

        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        if (periodEnd) {
          await db
            .update(organizationsTable)
            .set({ billingPeriodEnd: new Date(periodEnd * 1000) })
            .where(eq(organizationsTable.id, org.id));
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await db
          .update(organizationsTable)
          .set({
            plan: "none",
            stripeSubscriptionId: null,
            billingPeriodEnd: null,
          })
          .where(eq(organizationsTable.stripeSubscriptionId, sub.id));
        break;
      }
      default:
        break;
    }
  } catch (err) {
    logger.error({ err, type: event.type }, "Stripe webhook handler error");
    res.status(500).send("Webhook handler failed");
    return;
  }

  res.json({ received: true });
}

/* ————— Clerk webhook (organization sync only — billing is Stripe) ————— */

type ClerkWebhookEvent = {
  type: string;
  data: { id?: string; name?: string };
};

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
    if (event.type === "organization.created" || event.type === "organization.updated") {
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

export default router;
