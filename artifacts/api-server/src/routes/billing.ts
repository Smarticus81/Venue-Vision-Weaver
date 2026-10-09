import { Router, type IRouter, type Request, type Response } from "express";
import { Webhook } from "svix";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  organizationsTable,
  venuesTable,
  creditTransactionsTable,
  stripeEventsTable,
  type Organization,
  type BillingEventKind,
} from "@workspace/db";
import {
  grantCreditsToOrg,
  grantPlanCredits,
  recordBillingEvent,
  type PlanGrant,
} from "../lib/credits.js";
import {
  requireStripe,
  isStripeConfigured,
  isStripeClientConfigured,
  STRIPE_PRICES,
  getAppBaseUrl,
  isBillingProduct,
  isSubscriptionProduct,
  subscriptionQuota,
  creditPackAmount,
  productForPriceId,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  invoiceCustomerId,
  invoiceBillingReason,
  invoiceBilledPriceIds,
  invoicePeriodEnd,
  invoiceAmountPaid,
  invoiceAmountDue,
  subscriptionPriceIds,
  subscriptionMetadata,
  subscriptionCustomerId,
  subscriptionPeriodEnd,
  organizationIdFromMetadata,
  type BillingProduct,
  type SubscriptionProduct,
} from "../lib/stripe.js";
import {
  requireOrg,
  requireOrgAdmin,
  requireOwnerMutationOrigin,
  ensureOrganizationByClerkId,
  fetchClerkUserEmail,
  type OrgContext,
} from "../lib/orgAuth.js";
import { trialState } from "../lib/trial.js";
import { recordFunnelEvent, type FunnelEventInput } from "../lib/funnelEvents.js";
import { recordAuditEvent } from "../control-plane/audit.js";
import { UpdateOrganizationBody } from "@workspace/api-zod";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/* ————— Org summary (dashboard) ————— */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET /org — the caller's organization: plan, credits, trial clock, and its venues.
router.get("/org", async (req, res): Promise<void> => {
  const ctx = await requireOrg(req, res);
  if (!ctx) return;
  res.json(await organizationPayload(ctx));
});

// PATCH /org — organization preferences (aggregate-proof opt-in, contact
// email). Admins only: these change what the public site may say about the
// venue and where lifecycle email goes.
router.patch("/org", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;

  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  if (!requireOrgAdmin(ctx)) {
    res.status(403).json({
      error: "Only organization admins can change organization settings.",
      code: "org_admin_required",
    });
    return;
  }

  const body = UpdateOrganizationBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const updates: Partial<Pick<Organization, "shareAggregates" | "contactEmail">> = {};
  if (body.data.shareAggregates !== undefined) {
    updates.shareAggregates = body.data.shareAggregates;
  }
  if (body.data.contactEmail !== undefined) {
    const email = body.data.contactEmail?.trim().toLowerCase() || null;
    if (email && !EMAIL_REGEX.test(email)) {
      res.status(400).json({ error: "contactEmail must be a valid email address" });
      return;
    }
    updates.contactEmail = email;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(organizationsTable)
    .set(updates)
    .where(eq(organizationsTable.id, ctx.org.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  res.json(await organizationPayload({ ...ctx, org: updated }));
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

/** Shared GET/PATCH /org body. Declared after the routes (hoisted) so the venues query reads next to them. */
async function organizationPayload(ctx: OrgContext) {
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

  return {
    organization: {
      id: ctx.org.id,
      name: ctx.org.name,
      plan: ctx.org.plan,
      creditsBalance: ctx.org.creditsBalance,
      billingPeriodEnd: ctx.org.billingPeriodEnd,
      clerkOrgId: ctx.org.clerkOrgId,
      contactEmail: ctx.org.contactEmail,
      firstPaidAt: ctx.org.firstPaidAt,
      churnedAt: ctx.org.churnedAt,
      shareAggregates: ctx.org.shareAggregates,
      trial: trialState(ctx.org),
      role: ctx.orgRole,
      billingConfigured: isStripeConfigured(),
      // Additive lifecycle fields (not yet in OrganizationResponse; see WS-A contract follow-ups).
      subscriptionStatus: ctx.org.subscriptionStatus,
      cancelAtPeriodEnd: ctx.org.cancelAtPeriodEnd,
    },
    venues,
  };
}

/* ————— Stripe billing (organization-scoped) ————— */

/**
 * Stripe customer for the organization. Idempotent under concurrent calls:
 * the Stripe request carries a per-org idempotency key (Stripe returns the
 * same customer for a replay) and the DB write only fills an empty column, so
 * two racing requests converge on one customer id.
 */
async function ensureStripeCustomer(org: Organization, clerkUserId: string): Promise<string> {
  const stripe = requireStripe();
  if (org.stripeCustomerId) return org.stripeCustomerId;

  // Only hit Clerk for the billing email on first-time customer creation.
  const billingEmail = await fetchClerkUserEmail(clerkUserId);
  const customer = await stripe.customers.create(
    {
      email: billingEmail ?? undefined,
      name: org.name,
      metadata: { organizationId: String(org.id), clerkOrgId: org.clerkOrgId },
    },
    { idempotencyKey: `org-${org.id}-customer-v1` },
  );

  const [claimed] = await db
    .update(organizationsTable)
    .set({
      stripeCustomerId: customer.id,
      // growth-loop 7.1: the billing email is the best-known human contact when none is set.
      ...(org.contactEmail == null && billingEmail ? { contactEmail: billingEmail } : {}),
    })
    .where(and(eq(organizationsTable.id, org.id), isNull(organizationsTable.stripeCustomerId)))
    .returning({ stripeCustomerId: organizationsTable.stripeCustomerId });
  if (claimed?.stripeCustomerId) return claimed.stripeCustomerId;

  // Another request stored a customer first; use that one.
  const [current] = await db
    .select({ stripeCustomerId: organizationsTable.stripeCustomerId })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, org.id));
  return current?.stripeCustomerId ?? customer.id;
}

function hasLiveSubscription(org: Pick<Organization, "stripeSubscriptionId" | "subscriptionStatus">): boolean {
  return Boolean(org.stripeSubscriptionId) && org.subscriptionStatus !== "canceled";
}

// POST /org/billing/checkout — start Stripe Checkout for the caller's org.
router.post("/org/billing/checkout", async (req, res): Promise<void> => {
  if (!requireOwnerMutationOrigin(req, res)) return;
  if (!isStripeConfigured()) {
    res.status(503).json({ error: "Billing is not configured on this server.", code: "billing_not_configured" });
    return;
  }

  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  if (!requireOrgAdmin(ctx)) {
    res.status(403).json({
      error: "Only organization admins can change billing.",
      code: "org_admin_required",
    });
    return;
  }

  const product: unknown = req.body?.product;
  if (!isBillingProduct(product)) {
    res.status(400).json({ error: "product must be starter, growth, or credit_pack", code: "invalid_product" });
    return;
  }

  const priceId = STRIPE_PRICES[product];
  if (!priceId) {
    res.status(503).json({ error: "Price not configured for this product", code: "billing_not_configured" });
    return;
  }

  const isSubscription = isSubscriptionProduct(product);

  try {
    const stripe = requireStripe();
    const customerId = await ensureStripeCustomer(ctx.org, ctx.clerkUserId);
    const base = getAppBaseUrl();

    // One subscription per organization: a plan change goes through the
    // portal's subscription-update flow so Stripe prorates instead of opening
    // a second subscription (double billing).
    let subscribed = isSubscription && hasLiveSubscription(ctx.org);
    if (subscribed) {
      // Our row can lag Stripe (a lost or reordered deletion event). A plan
      // change flow for a canceled subscription is refused by Stripe, so a
      // subscription that is over sends the org to a fresh checkout instead.
      const live = await stripe.subscriptions
        .retrieve(ctx.org.stripeSubscriptionId as string)
        .catch((err: unknown) => {
          logger.warn({ err, orgId: ctx.org.id }, "Could not verify the Stripe subscription before checkout");
          return null;
        });
      if (live && isCanceledStripeSubscription(live)) {
        await db
          .update(organizationsTable)
          .set({ stripeSubscriptionId: null, subscriptionStatus: "canceled" })
          .where(eq(organizationsTable.id, ctx.org.id));
        subscribed = false;
      }
    }
    if (subscribed) {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${base}/dashboard`,
        flow_data: {
          type: "subscription_update",
          subscription_update: { subscription: ctx.org.stripeSubscriptionId as string },
        },
      });
      res.status(409).json({
        error: "This organization already has a subscription. Change plans in the billing portal.",
        code: "subscription_exists",
        url: portal.url,
      });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: isSubscription ? "subscription" : "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/dashboard?billing=success`,
      cancel_url: `${base}/dashboard?billing=cancel`,
      client_reference_id: String(ctx.org.id),
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

    void recordFunnelEvent({
      organizationId: ctx.org.id,
      event: "checkout_started",
      properties: { product, plan: ctx.org.plan },
      source: "server",
    });

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
    res.status(503).json({ error: "Billing is not configured on this server.", code: "billing_not_configured" });
    return;
  }

  const ctx = await requireOrg(req, res);
  if (!ctx) return;

  if (!requireOrgAdmin(ctx)) {
    res.status(403).json({
      error: "Only organization admins can change billing.",
      code: "org_admin_required",
    });
    return;
  }

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

/* ————— Stripe webhook core (pure over a BillingStore; tests inject one) ————— */

export type BillingOrg = Pick<
  Organization,
  | "id"
  | "name"
  | "plan"
  | "creditsBalance"
  | "stripeCustomerId"
  | "stripeSubscriptionId"
  | "billingPeriodEnd"
  | "subscriptionStatus"
  | "cancelAtPeriodEnd"
  | "firstPaidAt"
  | "churnedAt"
  | "contactEmail"
>;

export type BillingOrgPatch = Partial<
  Pick<
    BillingOrg,
    | "plan"
    | "stripeCustomerId"
    | "stripeSubscriptionId"
    | "billingPeriodEnd"
    | "subscriptionStatus"
    | "cancelAtPeriodEnd"
    | "firstPaidAt"
    | "churnedAt"
    | "contactEmail"
  >
>;

export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: unknown };
}

export interface BillingStore {
  /** Record the event id before acting. Returns false when the id was already recorded (replay). */
  recordStripeEvent(event: StripeEventLike): Promise<boolean>;
  /** Undo recordStripeEvent so Stripe's retry of a failed delivery is processed. */
  forgetStripeEvent(eventId: string): Promise<void>;
  findOrgById(id: number): Promise<BillingOrg | null>;
  findOrgByCustomerId(customerId: string): Promise<BillingOrg | null>;
  findOrgBySubscriptionId(subscriptionId: string): Promise<BillingOrg | null>;
  updateOrg(id: number, patch: BillingOrgPatch): Promise<BillingOrg | null>;
  grantPackCredits(orgId: number, amount: number, stripeEventId: string): Promise<number>;
  grantPlanCredits(orgId: number, quota: number, stripeEventId: string): Promise<PlanGrant>;
  recordBillingEvent(input: {
    organizationId: number;
    kind: BillingEventKind;
    plan?: string | null;
    faceValueCredits?: number | null;
    amountCents?: number | null;
    stripeEventId?: string | null;
  }): Promise<void>;
  recordFunnelEvent(input: FunnelEventInput): Promise<void>;
  recordAudit(input: { eventType: string; subjectId: number; detail: Record<string, unknown> }): Promise<void>;
  /** Stripe API lookup used only when the payload itself does not name the organization. */
  retrieveSubscription(subscriptionId: string): Promise<unknown | null>;
  now(): Date;
}

export function createDbBillingStore(): BillingStore {
  return {
    async recordStripeEvent(event) {
      const inserted = await db
        .insert(stripeEventsTable)
        .values({
          eventId: event.id,
          type: event.type,
          payload: { object: event.data.object } as Record<string, unknown>,
        })
        .onConflictDoNothing({ target: stripeEventsTable.eventId })
        .returning({ id: stripeEventsTable.id });
      return inserted.length > 0;
    },
    async forgetStripeEvent(eventId) {
      await db.delete(stripeEventsTable).where(eq(stripeEventsTable.eventId, eventId));
    },
    async findOrgById(id) {
      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, id));
      return org ?? null;
    },
    async findOrgByCustomerId(customerId) {
      const [org] = await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.stripeCustomerId, customerId));
      return org ?? null;
    },
    async findOrgBySubscriptionId(subscriptionId) {
      const [org] = await db
        .select()
        .from(organizationsTable)
        .where(eq(organizationsTable.stripeSubscriptionId, subscriptionId));
      return org ?? null;
    },
    async updateOrg(id, patch) {
      const [updated] = await db
        .update(organizationsTable)
        .set(patch)
        .where(eq(organizationsTable.id, id))
        .returning();
      return updated ?? null;
    },
    grantPackCredits(orgId, amount, stripeEventId) {
      return grantCreditsToOrg(orgId, amount, "pack_purchase", stripeEventId);
    },
    grantPlanCredits(orgId, quota, stripeEventId) {
      return grantPlanCredits(orgId, quota, stripeEventId);
    },
    recordBillingEvent,
    recordFunnelEvent,
    recordAudit({ eventType, subjectId, detail }) {
      return recordAuditEvent({
        actorType: "system",
        actor: "stripe-webhook",
        eventType,
        subjectType: "organization",
        subjectId,
        detail,
      });
    },
    async retrieveSubscription(subscriptionId) {
      try {
        return await requireStripe().subscriptions.retrieve(subscriptionId);
      } catch (err) {
        logger.warn({ err, subscriptionId }, "Could not retrieve Stripe subscription");
        return null;
      }
    },
    now: () => new Date(),
  };
}

export class UnresolvedOrganizationError extends Error {
  constructor(public readonly eventType: string, public readonly hint: string) {
    super(`Could not resolve organization for ${eventType} (${hint})`);
    this.name = "UnresolvedOrganizationError";
  }
}

export interface StripeEventOutcome {
  /** What the handler did, for logs and tests. */
  handled: string;
  organizationId?: number;
  grant?: PlanGrant;
}

type LooseRecord = Record<string, unknown>;
function asRecord(value: unknown): LooseRecord {
  return value && typeof value === "object" ? (value as LooseRecord) : {};
}
function stringField(obj: unknown, key: string): string | null {
  const v = asRecord(obj)[key];
  return typeof v === "string" ? v : null;
}
function numberField(obj: unknown, key: string): number | null {
  const v = asRecord(obj)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Stripe subscription status -> organizations.subscription_status. */
export function mapSubscriptionStatus(status: string | null | undefined): Organization["subscriptionStatus"] {
  switch (status) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null;
  }
}

function tierFromPriceIds(priceIds: string[]): SubscriptionProduct | null {
  for (const priceId of priceIds) {
    const product = productForPriceId(priceId);
    if (isSubscriptionProduct(product)) return product;
  }
  return null;
}

/**
 * Resolve the organization a subscription event belongs to, in this order:
 * our own stripe_subscription_id, the subscription metadata.organizationId we
 * set at checkout (echoed on invoices; retrieved from Stripe when absent),
 * then the Stripe customer id. Backfills stripe_subscription_id and
 * stripe_customer_id on the org row when they were missing (this is what makes
 * invoice.paid-before-checkout.session.completed work).
 */
async function resolveSubscriptionOrg(
  store: BillingStore,
  input: {
    subscriptionId: string | null;
    metadata: Record<string, string>;
    customerId: string | null;
    eventType: string;
  },
): Promise<{ org: BillingOrg; subscription: unknown | null; deadAfterCancel: boolean }> {
  let subscription: unknown | null = null;
  let org: BillingOrg | null = null;

  if (input.subscriptionId) org = await store.findOrgBySubscriptionId(input.subscriptionId);

  if (!org) {
    let orgId = organizationIdFromMetadata(input.metadata);
    if (orgId == null && input.subscriptionId) {
      subscription = await store.retrieveSubscription(input.subscriptionId);
      orgId = organizationIdFromMetadata(subscriptionMetadata(subscription));
    }
    if (orgId != null) org = await store.findOrgById(orgId);
  }

  if (!org) {
    const customerId = input.customerId ?? subscriptionCustomerId(subscription);
    if (customerId) org = await store.findOrgByCustomerId(customerId);
  }

  if (!org) {
    throw new UnresolvedOrganizationError(
      input.eventType,
      `subscription=${input.subscriptionId ?? "none"} customer=${input.customerId ?? "none"}`,
    );
  }

  // Stripe does not order events and retries for days: an invoice.paid or
  // subscription.updated for a subscription this org already saw deleted can
  // arrive after customer.subscription.deleted. Ask Stripe for the live
  // status before treating it as the org's subscription again.
  let deadAfterCancel = false;
  if (input.subscriptionId && org.subscriptionStatus === "canceled" && org.stripeSubscriptionId !== input.subscriptionId) {
    subscription ??= await store.retrieveSubscription(input.subscriptionId);
    deadAfterCancel = isCanceledStripeSubscription(subscription);
  }

  const backfill: BillingOrgPatch = {};
  if (
    input.subscriptionId &&
    !deadAfterCancel &&
    org.stripeSubscriptionId !== input.subscriptionId &&
    !hasLiveSubscription(org)
  ) {
    backfill.stripeSubscriptionId = input.subscriptionId;
  }
  if (!org.stripeCustomerId) {
    const customerId = input.customerId ?? subscriptionCustomerId(subscription);
    if (customerId) backfill.stripeCustomerId = customerId;
  }
  if (Object.keys(backfill).length > 0) {
    org = (await store.updateOrg(org.id, backfill)) ?? { ...org, ...backfill };
  }
  return { org, subscription, deadAfterCancel };
}

/** True when a retrieved Stripe subscription is over (canceled or incomplete_expired). */
export function isCanceledStripeSubscription(subscription: unknown): boolean {
  return mapSubscriptionStatus(stringField(subscription, "status")) === "canceled";
}

async function auditPlanChange(
  store: BillingStore,
  org: BillingOrg,
  to: string,
  eventType: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (org.plan === to) return;
  await store.recordAudit({
    eventType: "org_plan_changed",
    subjectId: org.id,
    detail: { from: org.plan, to, event: eventType, ...extra },
  });
}

async function applyPackPurchase(
  store: BillingStore,
  event: StripeEventLike,
  session: unknown,
  org: BillingOrg,
): Promise<StripeEventOutcome> {
  const amount = creditPackAmount();
  const newBalance = await store.grantPackCredits(org.id, amount, event.id);
  const now = store.now();
  // E4: a pack on a trial/none org is "pay as you go"; a subscriber keeps their plan.
  const nextPlan = org.plan === "trial" || org.plan === "none" ? "payg" : org.plan;
  await store.updateOrg(org.id, {
    plan: nextPlan,
    firstPaidAt: org.firstPaidAt ?? now,
  });
  await auditPlanChange(store, org, nextPlan, event.type);
  await store.recordBillingEvent({
    organizationId: org.id,
    kind: "pack_purchased",
    plan: nextPlan,
    faceValueCredits: amount,
    amountCents: numberField(session, "amount_total"),
    stripeEventId: event.id,
  });
  await store.recordFunnelEvent({
    organizationId: org.id,
    event: "pack_purchased",
    properties: { credits: amount, plan: nextPlan, firstPurchase: org.firstPaidAt == null },
    source: "stripe",
  });
  return { handled: "pack_purchased", organizationId: org.id, grant: { newBalance, delta: amount, faceValue: amount, clipped: false } };
}

async function handleCheckoutCompleted(
  store: BillingStore,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const session = event.data.object;
  const metadata = asRecord(asRecord(session).metadata);
  const organizationId = organizationIdFromMetadata(metadata);
  const product = metadata.product;
  if (organizationId == null || !isBillingProduct(product)) {
    // Not one of ours (another product on the same Stripe account).
    return { handled: "ignored_foreign_checkout" };
  }
  const org = await store.findOrgById(organizationId);
  if (!org) throw new UnresolvedOrganizationError(event.type, `organizationId=${organizationId}`);

  const customerId = stringField(session, "customer") ?? stringField(asRecord(session).customer, "id");
  if (customerId && !org.stripeCustomerId) await store.updateOrg(org.id, { stripeCustomerId: customerId });

  await store.recordFunnelEvent({
    organizationId: org.id,
    event: "checkout_completed",
    properties: { product, paymentStatus: stringField(session, "payment_status") },
    source: "stripe",
  });

  if (product === "credit_pack") {
    // Packs only count when the money is in. Delayed methods pay later via
    // checkout.session.async_payment_succeeded.
    if (stringField(session, "payment_status") !== "paid") {
      return { handled: "pack_pending_payment", organizationId: org.id };
    }
    return applyPackPurchase(store, event, session, org);
  }

  // Subscription: the plan starts now; credits arrive with invoice.paid
  // (billing_reason subscription_create), whichever order Stripe delivers.
  const subscriptionId =
    stringField(session, "subscription") ?? stringField(asRecord(session).subscription, "id");
  const paymentStatus = stringField(session, "payment_status");
  if (paymentStatus !== "paid" && paymentStatus !== "no_payment_required") {
    // Delayed methods (ACH, SEPA, Bacs) complete checkout before the money is
    // in. Remember the subscription, but leave plan and status alone: an
    // expired trial must not be lifted until invoice.paid confirms payment.
    if (subscriptionId && !org.stripeSubscriptionId) {
      await store.updateOrg(org.id, { stripeSubscriptionId: subscriptionId });
    }
    return { handled: "subscription_pending_payment", organizationId: org.id };
  }
  const patch: BillingOrgPatch = {
    plan: product,
    subscriptionStatus: "active",
    cancelAtPeriodEnd: false,
    churnedAt: null,
    firstPaidAt: org.firstPaidAt ?? store.now(),
  };
  if (subscriptionId) patch.stripeSubscriptionId = subscriptionId;
  await store.updateOrg(org.id, patch);
  await auditPlanChange(store, org, product, event.type, { subscriptionId });
  return { handled: "subscription_checkout_completed", organizationId: org.id };
}

async function handleAsyncPaymentSucceeded(
  store: BillingStore,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const session = event.data.object;
  const metadata = asRecord(asRecord(session).metadata);
  const organizationId = organizationIdFromMetadata(metadata);
  if (organizationId == null || metadata.product !== "credit_pack") {
    return { handled: "ignored_async_payment" };
  }
  const org = await store.findOrgById(organizationId);
  if (!org) throw new UnresolvedOrganizationError(event.type, `organizationId=${organizationId}`);
  return applyPackPurchase(store, event, session, org);
}

async function handleAsyncPaymentFailed(
  store: BillingStore,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const session = event.data.object;
  const metadata = asRecord(asRecord(session).metadata);
  const organizationId = organizationIdFromMetadata(metadata);
  if (organizationId == null) return { handled: "ignored_async_payment_failed" };
  const org = await store.findOrgById(organizationId);
  if (!org) return { handled: "ignored_async_payment_failed" };
  await store.recordBillingEvent({
    organizationId: org.id,
    kind: "payment_failed",
    plan: org.plan,
    amountCents: numberField(session, "amount_total"),
    stripeEventId: event.id,
  });
  await store.recordFunnelEvent({
    organizationId: org.id,
    event: "payment_failed",
    properties: { product: metadata.product ?? null, stage: "checkout" },
    source: "stripe",
  });
  return { handled: "pack_payment_failed", organizationId: org.id };
}

const GRANTING_BILLING_REASONS = new Set(["subscription_create", "subscription_cycle"]);

async function handleInvoicePaid(store: BillingStore, event: StripeEventLike): Promise<StripeEventOutcome> {
  const invoice = event.data.object;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { handled: "ignored_non_subscription_invoice" };

  const metadata = invoiceSubscriptionMetadata(invoice);
  const { org, subscription, deadAfterCancel } = await resolveSubscriptionOrg(store, {
    subscriptionId,
    metadata,
    customerId: invoiceCustomerId(invoice),
    eventType: event.type,
  });

  const reason = invoiceBillingReason(invoice);
  if (deadAfterCancel) {
    // A late delivery for a subscription that is already deleted: the period
    // was paid, so its credits are granted (additive and idempotent), but the
    // canceled subscription is never brought back as the org's plan.
    if (!reason || !GRANTING_BILLING_REASONS.has(reason)) {
      return { handled: "ignored_invoice_for_canceled_subscription", organizationId: org.id };
    }
    const lateTier =
      tierFromPriceIds(invoiceBilledPriceIds(invoice)) ??
      tierFromPriceIds(subscriptionPriceIds(subscription)) ??
      (isSubscriptionProduct(metadata.product) ? metadata.product : null);
    if (!lateTier) {
      throw new Error(
        `invoice.paid for canceled subscription ${subscriptionId}: cannot map the billed price to a plan (check STRIPE_PRICE_* env)`,
      );
    }
    const lateGrant = await store.grantPlanCredits(org.id, subscriptionQuota(lateTier), event.id);
    if (org.plan === "none" && lateGrant.newBalance > 0) {
      await store.updateOrg(org.id, { plan: "payg" });
      await auditPlanChange(store, org, "payg", event.type, { billingReason: reason, subscriptionId });
    }
    await store.recordBillingEvent({
      organizationId: org.id,
      kind: "subscription_renewed",
      plan: lateTier,
      faceValueCredits: subscriptionQuota(lateTier),
      amountCents: invoiceAmountPaid(invoice),
      stripeEventId: event.id,
    });
    return { handled: "late_invoice_for_canceled_subscription", organizationId: org.id, grant: lateGrant };
  }
  const periodEnd = invoicePeriodEnd(invoice);
  const patch: BillingOrgPatch = {
    subscriptionStatus: "active",
    churnedAt: null,
    firstPaidAt: org.firstPaidAt ?? store.now(),
  };
  if (periodEnd != null) patch.billingPeriodEnd = new Date(periodEnd * 1000);

  // Which tier did Stripe bill? Line price id first, then the metadata we set
  // at checkout, then the plan we already know. Anything else is a
  // configuration problem (STRIPE_PRICE_* out of sync) that must retry.
  const tier =
    tierFromPriceIds(invoiceBilledPriceIds(invoice)) ??
    (isSubscriptionProduct(metadata.product) ? metadata.product : null) ??
    (subscription ? tierFromPriceIds(subscriptionPriceIds(subscription)) : null) ??
    (isSubscriptionProduct(org.plan) ? org.plan : null);

  if (!reason || !GRANTING_BILLING_REASONS.has(reason)) {
    // Proration / threshold / manual invoices: sync the plan, grant nothing.
    if (tier) patch.plan = tier;
    await store.updateOrg(org.id, patch);
    if (tier) await auditPlanChange(store, org, tier, event.type, { billingReason: reason });
    return { handled: `invoice_${reason ?? "unknown"}_no_grant`, organizationId: org.id };
  }

  if (!tier) {
    throw new Error(
      `invoice.paid for subscription ${subscriptionId}: cannot map the billed price to a plan (check STRIPE_PRICE_* env)`,
    );
  }

  const quota = subscriptionQuota(tier);
  const grant = await store.grantPlanCredits(org.id, quota, event.id);
  patch.plan = tier;
  await store.updateOrg(org.id, patch);
  await auditPlanChange(store, org, tier, event.type, { billingReason: reason });

  const kind: BillingEventKind = reason === "subscription_create" ? "subscription_started" : "subscription_renewed";
  await store.recordBillingEvent({
    organizationId: org.id,
    kind,
    plan: tier,
    faceValueCredits: quota,
    amountCents: invoiceAmountPaid(invoice),
    stripeEventId: event.id,
  });
  if (kind === "subscription_started") {
    await store.recordFunnelEvent({
      organizationId: org.id,
      event: "subscription_started",
      properties: { plan: tier, credits: grant.delta, firstPurchase: org.firstPaidAt == null },
      source: "stripe",
    });
  }
  return { handled: kind, organizationId: org.id, grant };
}

async function handleInvoicePaymentFailed(
  store: BillingStore,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const invoice = event.data.object;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return { handled: "ignored_non_subscription_invoice" };
  const { org, deadAfterCancel } = await resolveSubscriptionOrg(store, {
    subscriptionId,
    metadata: invoiceSubscriptionMetadata(invoice),
    customerId: invoiceCustomerId(invoice),
    eventType: event.type,
  });
  if (deadAfterCancel) return { handled: "ignored_payment_failed_for_canceled_subscription", organizationId: org.id };
  await store.updateOrg(org.id, { subscriptionStatus: "past_due" });
  await store.recordBillingEvent({
    organizationId: org.id,
    kind: "payment_failed",
    plan: org.plan,
    amountCents: invoiceAmountDue(invoice),
    stripeEventId: event.id,
  });
  await store.recordFunnelEvent({
    organizationId: org.id,
    event: "payment_failed",
    properties: { plan: org.plan, stage: "invoice", billingReason: invoiceBillingReason(invoice) },
    source: "stripe",
  });
  await store.recordAudit({
    eventType: "org_payment_failed",
    subjectId: org.id,
    detail: { plan: org.plan, subscriptionId, event: event.type },
  });
  return { handled: "payment_failed", organizationId: org.id };
}

async function handleSubscriptionUpdated(
  store: BillingStore,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const sub = event.data.object;
  const subscriptionId = stringField(sub, "id");
  if (!subscriptionId) return { handled: "ignored_subscription_without_id" };
  const { org, deadAfterCancel } = await resolveSubscriptionOrg(store, {
    subscriptionId,
    metadata: subscriptionMetadata(sub),
    customerId: subscriptionCustomerId(sub),
    eventType: event.type,
  });
  // An old snapshot of a subscription that is deleted now: never reactivate it.
  if (deadAfterCancel) return { handled: "ignored_update_for_canceled_subscription", organizationId: org.id };

  const status = mapSubscriptionStatus(stringField(sub, "status"));
  const patch: BillingOrgPatch = {
    cancelAtPeriodEnd: asRecord(sub).cancel_at_period_end === true,
  };
  if (status) patch.subscriptionStatus = status;
  const periodEnd = subscriptionPeriodEnd(sub);
  if (periodEnd != null) patch.billingPeriodEnd = new Date(periodEnd * 1000);

  // Plan follows the price Stripe now bills (portal upgrades/downgrades).
  // Credits for the new tier arrive with the next cycle invoice; proration
  // invoices grant nothing (E2 never SETs a balance).
  const tier = tierFromPriceIds(subscriptionPriceIds(sub));
  if (tier && status !== "canceled") patch.plan = tier;

  await store.updateOrg(org.id, patch);
  if (tier && tier !== org.plan && status !== "canceled") {
    await auditPlanChange(store, org, tier, event.type, { status });
    await store.recordBillingEvent({
      organizationId: org.id,
      kind: "subscription_updated",
      plan: tier,
      faceValueCredits: subscriptionQuota(tier),
      stripeEventId: event.id,
    });
  }
  return { handled: "subscription_updated", organizationId: org.id };
}

async function handleSubscriptionPauseState(
  store: BillingStore,
  event: StripeEventLike,
  status: "paused" | "active",
): Promise<StripeEventOutcome> {
  const sub = event.data.object;
  const subscriptionId = stringField(sub, "id");
  if (!subscriptionId) return { handled: "ignored_subscription_without_id" };
  const { org, deadAfterCancel } = await resolveSubscriptionOrg(store, {
    subscriptionId,
    metadata: subscriptionMetadata(sub),
    customerId: subscriptionCustomerId(sub),
    eventType: event.type,
  });
  if (deadAfterCancel) return { handled: `ignored_${status}_for_canceled_subscription`, organizationId: org.id };
  await store.updateOrg(org.id, { subscriptionStatus: status });
  await store.recordAudit({
    eventType: status === "paused" ? "org_subscription_paused" : "org_subscription_resumed",
    subjectId: org.id,
    detail: { subscriptionId, event: event.type },
  });
  return { handled: `subscription_${status}`, organizationId: org.id };
}

async function handleSubscriptionDeleted(
  store: BillingStore,
  event: StripeEventLike,
): Promise<StripeEventOutcome> {
  const sub = event.data.object;
  const subscriptionId = stringField(sub, "id");
  if (!subscriptionId) return { handled: "ignored_subscription_without_id" };

  let resolved: { org: BillingOrg; deadAfterCancel: boolean } | null = null;
  try {
    resolved = await resolveSubscriptionOrg(store, {
      subscriptionId,
      metadata: subscriptionMetadata(sub),
      customerId: subscriptionCustomerId(sub),
      eventType: event.type,
    });
  } catch (err) {
    if (err instanceof UnresolvedOrganizationError) {
      // A subscription we never knew about (deleted test data, foreign product): nothing to churn.
      return { handled: "ignored_unknown_subscription_deleted" };
    }
    throw err;
  }
  const { org } = resolved;
  if (resolved.deadAfterCancel) {
    // A second delivery of a deletion this org already applied.
    return { handled: "ignored_repeat_subscription_deleted", organizationId: org.id };
  }

  // Only act when this is the org's current subscription (a stale deletion
  // after a replacement subscription must not churn the new plan).
  if (org.stripeSubscriptionId && org.stripeSubscriptionId !== subscriptionId) {
    return { handled: "ignored_stale_subscription_deleted", organizationId: org.id };
  }

  // E4: credits are never removed; packs keep the org on pay-as-you-go.
  const nextPlan = org.creditsBalance > 0 ? "payg" : "none";
  await store.updateOrg(org.id, {
    plan: nextPlan,
    stripeSubscriptionId: null,
    billingPeriodEnd: null,
    subscriptionStatus: "canceled",
    cancelAtPeriodEnd: false,
    churnedAt: store.now(),
  });
  await auditPlanChange(store, org, nextPlan, event.type, { subscriptionId });
  await store.recordBillingEvent({
    organizationId: org.id,
    kind: "subscription_canceled",
    plan: org.plan,
    stripeEventId: event.id,
  });
  await store.recordFunnelEvent({
    organizationId: org.id,
    event: "subscription_canceled",
    properties: { fromPlan: org.plan, toPlan: nextPlan, creditsRemaining: org.creditsBalance },
    source: "stripe",
  });
  return { handled: "subscription_canceled", organizationId: org.id };
}

/**
 * Apply one verified Stripe event. The caller has already recorded the event
 * id in stripe_events (idempotency) and verifies the signature; this function
 * is deterministic over the store so tests can replay deliveries in any order.
 * Throws when the organization cannot be resolved so the webhook answers 500
 * and Stripe retries (E3).
 */
export async function processStripeEvent(event: StripeEventLike, store: BillingStore): Promise<StripeEventOutcome> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutCompleted(store, event);
    case "checkout.session.async_payment_succeeded":
      return handleAsyncPaymentSucceeded(store, event);
    case "checkout.session.async_payment_failed":
      return handleAsyncPaymentFailed(store, event);
    case "invoice.paid":
      return handleInvoicePaid(store, event);
    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(store, event);
    case "customer.subscription.updated":
      return handleSubscriptionUpdated(store, event);
    case "customer.subscription.paused":
      return handleSubscriptionPauseState(store, event, "paused");
    case "customer.subscription.resumed":
      return handleSubscriptionPauseState(store, event, "active");
    case "customer.subscription.deleted":
      return handleSubscriptionDeleted(store, event);
    default:
      return { handled: "ignored_event_type" };
  }
}

/**
 * Verified webhook delivery -> stripe_events -> processStripeEvent. A replayed
 * event id answers 200 without acting; a handler failure forgets the event id
 * and answers 500 so Stripe redelivers.
 */
export async function runStripeWebhookEvent(
  event: StripeEventLike,
  store: BillingStore,
): Promise<{ status: 200 | 500; body: Record<string, unknown> }> {
  const fresh = await store.recordStripeEvent(event);
  if (!fresh) {
    logger.info({ eventId: event.id, type: event.type }, "Stripe event already processed");
    return { status: 200, body: { received: true, duplicate: true } };
  }
  try {
    const outcome = await processStripeEvent(event, store);
    logger.info({ eventId: event.id, type: event.type, ...outcome }, "Stripe event processed");
    return { status: 200, body: { received: true, handled: outcome.handled } };
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "Stripe webhook handler error");
    try {
      await store.forgetStripeEvent(event.id);
    } catch (forgetErr) {
      logger.error({ err: forgetErr, eventId: event.id }, "Could not release stripe_events row after failure");
    }
    return { status: 500, body: { error: "Webhook handler failed" } };
  }
}

export async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isStripeClientConfigured() || !webhookSecret) {
    res.status(503).send("Stripe webhook is not configured");
    return;
  }
  const stripe = requireStripe();

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

  const result = await runStripeWebhookEvent(event, createDbBillingStore());
  res.status(result.status).json(result.body);
}

/* ————— Clerk webhook (organization sync only — billing is Stripe) ————— */

type ClerkWebhookEvent = {
  type: string;
  data: { id?: string; name?: string; created_by?: string | null };
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
        // organization.created names the creating user, so the one-time trial
        // grant (once per Clerk user) can be ledgered even when the webhook
        // beats the member's first signed-in request.
        const org = await ensureOrganizationByClerkId(clerkOrgId, name, {
          clerkUserId: event.data.created_by ?? null,
        });
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

export { type BillingProduct };
export default router;
