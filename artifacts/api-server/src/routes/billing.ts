import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  venuesTable,
  creditTransactionsTable,
  STARTER_MONTHLY_CREDITS,
  GROWTH_MONTHLY_CREDITS,
  CREDIT_PACK_AMOUNT,
} from "@workspace/db";
import {
  grantCredits,
  setCreditsBalance,
} from "../lib/credits.js";
import {
  requireStripe,
  isStripeConfigured,
  STRIPE_PRICES,
  getAppBaseUrl,
  type BillingProduct,
} from "../lib/stripe.js";
import { logger } from "../lib/logger.js";
import { requireOwnerVenue } from "../lib/ownerAuth.js";

const router: IRouter = Router();

async function ensureStripeCustomer(
  venue: typeof venuesTable.$inferSelect,
): Promise<string> {
  const stripe = requireStripe();
  if (venue.stripeCustomerId) return venue.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: venue.ownerEmail ?? undefined,
    name: venue.name,
    metadata: { venueId: String(venue.id), venueSlug: venue.slug },
  });

  await db
    .update(venuesTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(venuesTable.id, venue.id));

  return customer.id;
}

// POST /venues/:slug/billing/checkout
router.post("/venues/:slug/billing/checkout", async (req, res): Promise<void> => {
  const slug = req.params.slug;
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Billing is not configured on this server." });
    return;
  }

  const venue = await requireOwnerVenue(req, res, slug);
  if (!venue) return;

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
    const customerId = await ensureStripeCustomer(venue);
    const base = getAppBaseUrl();

    const isSubscription = product === "starter" || product === "growth";
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/profile/${slug}?billing=success`,
      cancel_url: `${base}/profile/${slug}?billing=cancel`,
      metadata: {
        venueId: String(venue.id),
        venueSlug: slug,
        product,
      },
      subscription_data: isSubscription
        ? { metadata: { venueId: String(venue.id), product } }
        : undefined,
    });

    if (!session.url) {
      res.status(500).json({ error: "Failed to create checkout session" });
      return;
    }

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, slug, product }, "Stripe checkout failed");
    res.status(500).json({ error: "Could not start checkout" });
  }
});

// POST /venues/:slug/billing/portal
router.post("/venues/:slug/billing/portal", async (req, res): Promise<void> => {
  const slug = req.params.slug;
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Billing is not configured on this server." });
    return;
  }

  const venue = await requireOwnerVenue(req, res, slug);
  if (!venue) return;

  try {
    const stripe = requireStripe();
    const customerId = await ensureStripeCustomer(venue);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppBaseUrl()}/profile/${slug}`,
    });
    res.json({ url: portal.url });
  } catch (err) {
    logger.error({ err, slug }, "Stripe portal failed");
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
        const venueId = Number(session.metadata?.venueId);
        const product = session.metadata?.product as BillingProduct | undefined;
        if (!venueId || !product) break;

        if (product === "credit_pack") {
          await grantCredits(venueId, CREDIT_PACK_AMOUNT, "pack_purchase", event.id);
        } else if (product === "starter" || product === "growth") {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription?.id;
          await db
            .update(venuesTable)
            .set({
              plan: product,
              stripeSubscriptionId: subId ?? null,
            })
            .where(eq(venuesTable.id, venueId));
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

        const [venue] = await db
          .select()
          .from(venuesTable)
          .where(eq(venuesTable.stripeSubscriptionId, subId));
        if (!venue) break;

        const credits =
          venue.plan === "growth" ? GROWTH_MONTHLY_CREDITS : STARTER_MONTHLY_CREDITS;
        await setCreditsBalance(venue.id, credits, "subscription_grant", event.id);

        const periodEnd = invoice.lines?.data?.[0]?.period?.end;
        if (periodEnd) {
          await db
            .update(venuesTable)
            .set({ billingPeriodEnd: new Date(periodEnd * 1000) })
            .where(eq(venuesTable.id, venue.id));
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await db
          .update(venuesTable)
          .set({
            plan: "none",
            stripeSubscriptionId: null,
            billingPeriodEnd: null,
          })
          .where(eq(venuesTable.stripeSubscriptionId, sub.id));
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

export default router;
