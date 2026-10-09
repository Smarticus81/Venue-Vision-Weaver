import assert from "node:assert/strict";
import test from "node:test";

/*
 * WS-A billing suite: the Stripe webhook core is replayed against an in-memory
 * BillingStore (no database, no network). Env is pinned before the dynamic
 * imports because lib/stripe.ts reads STRIPE_PRICE_* at module load.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_starter";
process.env.STRIPE_PRICE_GROWTH_MONTHLY = "price_growth";
process.env.STRIPE_PRICE_CREDIT_PACK_10 = "price_pack";
process.env.PLAN_CREDIT_ROLLOVER_CAP = "3";
delete process.env.STRIPE_SECRET_KEY;

const billing = await import("./billing.js");
const credits = await import("../lib/credits.js");
const stripeLib = await import("../lib/stripe.js");
const orgAuth = await import("../lib/orgAuth.js");
const { STARTER_MONTHLY_CREDITS, GROWTH_MONTHLY_CREDITS, CREDIT_PACK_AMOUNT, TRIAL_CREDITS } = await import("@workspace/db");

type BillingOrg = import("./billing.js").BillingOrg;
type BillingStore = import("./billing.js").BillingStore;
type StripeEventLike = import("./billing.js").StripeEventLike;

const FIXED_NOW = new Date("2026-10-08T12:00:00Z");

interface Ledger {
  organizationId: number;
  delta: number;
  reason: string;
  stripeEventId: string | null;
}

interface FakeStore extends BillingStore {
  orgs: Map<number, BillingOrg>;
  stripeEvents: Set<string>;
  ledger: Ledger[];
  billingEvents: Array<Record<string, unknown>>;
  funnelEvents: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
  subscriptions: Map<string, unknown>;
  retrieveCalls: string[];
}

function makeOrg(overrides: Partial<BillingOrg> = {}): BillingOrg {
  return {
    id: 7,
    name: "Rustic Barn",
    plan: "trial",
    creditsBalance: 0,
    stripeCustomerId: "cus_7",
    stripeSubscriptionId: null,
    billingPeriodEnd: null,
    subscriptionStatus: null,
    cancelAtPeriodEnd: false,
    firstPaidAt: null,
    churnedAt: null,
    contactEmail: null,
    ...overrides,
  };
}

function makeStore(orgs: BillingOrg[], subscriptions: Record<string, unknown> = {}): FakeStore {
  const store: FakeStore = {
    orgs: new Map(orgs.map((org) => [org.id, { ...org }])),
    stripeEvents: new Set(),
    ledger: [],
    billingEvents: [],
    funnelEvents: [],
    audits: [],
    subscriptions: new Map(Object.entries(subscriptions)),
    retrieveCalls: [],
    async recordStripeEvent(event) {
      if (store.stripeEvents.has(event.id)) return false;
      store.stripeEvents.add(event.id);
      return true;
    },
    async forgetStripeEvent(eventId) {
      store.stripeEvents.delete(eventId);
    },
    async findOrgById(id) {
      const org = store.orgs.get(id);
      return org ? { ...org } : null;
    },
    async findOrgByCustomerId(customerId) {
      for (const org of store.orgs.values()) if (org.stripeCustomerId === customerId) return { ...org };
      return null;
    },
    async findOrgBySubscriptionId(subscriptionId) {
      for (const org of store.orgs.values()) if (org.stripeSubscriptionId === subscriptionId) return { ...org };
      return null;
    },
    async updateOrg(id, patch) {
      const org = store.orgs.get(id);
      if (!org) return null;
      Object.assign(org, patch);
      return { ...org };
    },
    async grantPackCredits(orgId, amount, stripeEventId) {
      if (store.ledger.some((row) => row.stripeEventId === stripeEventId)) return store.orgs.get(orgId)!.creditsBalance;
      const org = store.orgs.get(orgId)!;
      org.creditsBalance += amount;
      store.ledger.push({ organizationId: orgId, delta: amount, reason: "pack_purchase", stripeEventId });
      return org.creditsBalance;
    },
    async grantPlanCredits(orgId, quota, stripeEventId) {
      const org = store.orgs.get(orgId)!;
      const grant = credits.computePlanGrant({ balance: org.creditsBalance, quota, cap: 3 });
      if (grant.delta > 0) {
        org.creditsBalance = grant.newBalance;
        store.ledger.push({ organizationId: orgId, delta: grant.delta, reason: "subscription_grant", stripeEventId });
      }
      return grant;
    },
    async recordBillingEvent(input) {
      store.billingEvents.push({ ...input });
    },
    async recordFunnelEvent(input) {
      store.funnelEvents.push({ ...input });
    },
    async recordAudit(input) {
      store.audits.push({ ...input });
    },
    async retrieveSubscription(subscriptionId) {
      store.retrieveCalls.push(subscriptionId);
      return store.subscriptions.get(subscriptionId) ?? null;
    },
    now: () => FIXED_NOW,
  };
  return store;
}

function event(id: string, type: string, object: unknown): StripeEventLike {
  return { id, type, data: { object } };
}

function checkoutCompleted(opts: {
  id?: string;
  orgId: number;
  product: "starter" | "growth" | "credit_pack";
  subscription?: string;
  paymentStatus?: string;
  amountTotal?: number;
}): StripeEventLike {
  return event(opts.id ?? `evt_checkout_${opts.product}`, "checkout.session.completed", {
    id: "cs_1",
    object: "checkout.session",
    customer: "cus_7",
    mode: opts.product === "credit_pack" ? "payment" : "subscription",
    payment_status: opts.paymentStatus ?? "paid",
    amount_total: opts.amountTotal ?? (opts.product === "credit_pack" ? 5900 : 12900),
    subscription: opts.subscription ?? null,
    metadata: { organizationId: String(opts.orgId), product: opts.product },
  });
}

/** Classic (pre-basil) invoice: subscription id + line price at the top level. */
function classicInvoice(opts: {
  id?: string;
  subscription: string;
  priceId: string;
  billingReason: string;
  metadata?: Record<string, string>;
  periodEnd?: number;
  amountPaid?: number;
}): StripeEventLike {
  return event(opts.id ?? `evt_inv_${opts.billingReason}`, "invoice.paid", {
    id: "in_1",
    object: "invoice",
    customer: "cus_7",
    subscription: opts.subscription,
    subscription_details: opts.metadata ? { metadata: opts.metadata } : null,
    billing_reason: opts.billingReason,
    amount_paid: opts.amountPaid ?? 12900,
    lines: {
      data: [{ price: { id: opts.priceId }, period: { end: opts.periodEnd ?? 1_765_000_000 } }],
    },
  });
}

/** Basil (2025-03-31+) invoice: subscription under parent.subscription_details, price under pricing.price_details. */
function basilInvoice(opts: {
  id?: string;
  subscription: string;
  priceId: string;
  billingReason: string;
  metadata?: Record<string, string>;
}): StripeEventLike {
  return event(opts.id ?? `evt_basil_${opts.billingReason}`, "invoice.paid", {
    id: "in_2",
    object: "invoice",
    customer: "cus_7",
    parent: {
      type: "subscription_details",
      subscription_details: { subscription: opts.subscription, metadata: opts.metadata ?? {} },
    },
    billing_reason: opts.billingReason,
    amount_paid: 27900,
    lines: {
      data: [{ pricing: { price_details: { price: opts.priceId } }, period: { end: 1_765_000_000 } }],
    },
  });
}

function subscriptionObject(opts: {
  id: string;
  status: string;
  priceId: string;
  orgId?: number;
  product?: string;
  cancelAtPeriodEnd?: boolean;
  periodEnd?: number;
}): Record<string, unknown> {
  return {
    id: opts.id,
    object: "subscription",
    customer: "cus_7",
    status: opts.status,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    current_period_end: opts.periodEnd ?? 1_765_000_000,
    metadata: opts.orgId ? { organizationId: String(opts.orgId), product: opts.product ?? "starter" } : {},
    items: { data: [{ price: { id: opts.priceId }, current_period_end: opts.periodEnd ?? 1_765_000_000 }] },
  };
}

async function deliver(store: FakeStore, ...events: StripeEventLike[]): Promise<number[]> {
  const statuses: number[] = [];
  for (const evt of events) {
    const result = await billing.runStripeWebhookEvent(evt, store);
    statuses.push(result.status);
  }
  return statuses;
}

function grantsFor(store: FakeStore, reason: string): Ledger[] {
  return store.ledger.filter((row) => row.reason === reason);
}

/* ————— Webhook orderings ————— */

test("checkout.session.completed then invoice.paid grants first-month credits exactly once", async () => {
  const store = makeStore([makeOrg()]);
  const statuses = await deliver(
    store,
    checkoutCompleted({ orgId: 7, product: "starter", subscription: "sub_1" }),
    classicInvoice({ subscription: "sub_1", priceId: "price_starter", billingReason: "subscription_create" }),
  );
  assert.deepEqual(statuses, [200, 200]);
  const org = store.orgs.get(7)!;
  assert.equal(org.plan, "starter");
  assert.equal(org.stripeSubscriptionId, "sub_1");
  assert.equal(org.subscriptionStatus, "active");
  assert.equal(org.creditsBalance, STARTER_MONTHLY_CREDITS);
  assert.equal(org.firstPaidAt?.toISOString(), FIXED_NOW.toISOString());
  assert.equal(org.billingPeriodEnd?.getTime(), 1_765_000_000 * 1000);
  assert.equal(grantsFor(store, "subscription_grant").length, 1);
  assert.equal(store.retrieveCalls.length, 0, "payload named the org; no Stripe API lookup needed");
  assert.ok(store.billingEvents.some((row) => row.kind === "subscription_started" && row.faceValueCredits === STARTER_MONTHLY_CREDITS));
  assert.ok(store.funnelEvents.some((row) => row.event === "subscription_started"));
  assert.ok(store.funnelEvents.some((row) => row.event === "checkout_completed"));
});

test("invoice.paid BEFORE checkout.session.completed still grants exactly once (via subscription metadata)", async () => {
  const store = makeStore([makeOrg()]);
  const statuses = await deliver(
    store,
    classicInvoice({
      subscription: "sub_1",
      priceId: "price_starter",
      billingReason: "subscription_create",
      metadata: { organizationId: "7", product: "starter" },
    }),
    checkoutCompleted({ orgId: 7, product: "starter", subscription: "sub_1" }),
  );
  assert.deepEqual(statuses, [200, 200]);
  const org = store.orgs.get(7)!;
  assert.equal(org.creditsBalance, STARTER_MONTHLY_CREDITS, "first-period credits granted although invoice came first");
  assert.equal(org.plan, "starter");
  assert.equal(org.stripeSubscriptionId, "sub_1", "subscription id backfilled from the invoice");
  assert.equal(grantsFor(store, "subscription_grant").length, 1);
  assert.equal(store.billingEvents.filter((row) => row.kind === "subscription_started").length, 1);
});

test("invoice.paid first without echoed metadata retrieves the subscription from Stripe to find the org", async () => {
  const store = makeStore([makeOrg({ stripeCustomerId: null })], {
    sub_1: subscriptionObject({ id: "sub_1", status: "active", priceId: "price_growth", orgId: 7, product: "growth" }),
  });
  const statuses = await deliver(
    store,
    classicInvoice({ subscription: "sub_1", priceId: "price_growth", billingReason: "subscription_create" }),
  );
  assert.deepEqual(statuses, [200]);
  assert.deepEqual(store.retrieveCalls, ["sub_1"]);
  const org = store.orgs.get(7)!;
  assert.equal(org.creditsBalance, GROWTH_MONTHLY_CREDITS);
  assert.equal(org.plan, "growth");
  assert.equal(org.stripeCustomerId, "cus_7", "customer id backfilled");
});

test("invoice.paid resolves the org by Stripe customer id as the last fallback", async () => {
  const store = makeStore([makeOrg({ stripeCustomerId: "cus_7" })]);
  const statuses = await deliver(
    store,
    classicInvoice({ subscription: "sub_x", priceId: "price_starter", billingReason: "subscription_create" }),
  );
  assert.deepEqual(statuses, [200]);
  assert.equal(store.orgs.get(7)!.creditsBalance, STARTER_MONTHLY_CREDITS);
  assert.equal(store.orgs.get(7)!.stripeSubscriptionId, "sub_x");
});

test("basil-shaped invoice (parent.subscription_details, pricing.price_details) is read correctly", async () => {
  const store = makeStore([makeOrg()]);
  const statuses = await deliver(
    store,
    basilInvoice({
      subscription: "sub_b",
      priceId: "price_growth",
      billingReason: "subscription_create",
      metadata: { organizationId: "7", product: "growth" },
    }),
  );
  assert.deepEqual(statuses, [200]);
  const org = store.orgs.get(7)!;
  assert.equal(org.plan, "growth");
  assert.equal(org.creditsBalance, GROWTH_MONTHLY_CREDITS);
  assert.equal(org.stripeSubscriptionId, "sub_b");
  assert.equal(org.billingPeriodEnd?.getTime(), 1_765_000_000 * 1000);
});

test("unresolvable organization answers 500 and releases the event id so Stripe's retry is processed", async () => {
  const store = makeStore([]);
  const invoice = classicInvoice({ subscription: "sub_ghost", priceId: "price_starter", billingReason: "subscription_create" });
  const first = await billing.runStripeWebhookEvent(invoice, store);
  assert.equal(first.status, 500);
  assert.equal(store.stripeEvents.has(invoice.id), false, "event id forgotten after failure");
  // The org appears (e.g. checkout.session.completed lands) and the retry succeeds.
  store.orgs.set(7, makeOrg());
  const retry = await billing.runStripeWebhookEvent(invoice, store);
  assert.equal(retry.status, 200);
  assert.equal(store.orgs.get(7)!.creditsBalance, STARTER_MONTHLY_CREDITS);
});

test("duplicate event id is acknowledged without acting", async () => {
  const store = makeStore([makeOrg({ stripeSubscriptionId: "sub_1", plan: "starter" })]);
  const invoice = classicInvoice({ subscription: "sub_1", priceId: "price_starter", billingReason: "subscription_cycle" });
  const [first, second] = await deliver(store, invoice, invoice);
  assert.equal(first, 200);
  assert.equal(second, 200);
  assert.equal(store.orgs.get(7)!.creditsBalance, STARTER_MONTHLY_CREDITS);
  assert.equal(grantsFor(store, "subscription_grant").length, 1);
  assert.equal(store.billingEvents.length, 1);
});

/* ————— Additive renewals + packs ————— */

test("pack purchase then renewal keeps the pack: renewal is additive, never a SET", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", creditsBalance: 3, firstPaidAt: new Date("2026-09-01") })]);
  const statuses = await deliver(
    store,
    checkoutCompleted({ id: "evt_pack", orgId: 7, product: "credit_pack" }),
    classicInvoice({ id: "evt_cycle", subscription: "sub_1", priceId: "price_starter", billingReason: "subscription_cycle" }),
  );
  assert.deepEqual(statuses, [200, 200]);
  const org = store.orgs.get(7)!;
  assert.equal(org.creditsBalance, 3 + CREDIT_PACK_AMOUNT + STARTER_MONTHLY_CREDITS);
  assert.equal(org.plan, "starter", "a subscriber buying a pack keeps the plan");
  assert.deepEqual(
    store.ledger.map((row) => [row.reason, row.delta]),
    [["pack_purchase", CREDIT_PACK_AMOUNT], ["subscription_grant", STARTER_MONTHLY_CREDITS]],
  );
  assert.ok(store.ledger.every((row) => row.delta > 0), "no negative ledger deltas");
  assert.ok(store.billingEvents.some((row) => row.kind === "pack_purchased" && row.amountCents === 5900));
  assert.ok(store.billingEvents.some((row) => row.kind === "subscription_renewed"));
  assert.ok(store.funnelEvents.some((row) => row.event === "pack_purchased"));
});

test("renewal grants are clipped by the rollover cap but never lower the balance", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", creditsBalance: 70 })]);
  await deliver(store, classicInvoice({ id: "evt_c1", subscription: "sub_1", priceId: "price_starter", billingReason: "subscription_cycle" }));
  assert.equal(store.orgs.get(7)!.creditsBalance, 75, "70 + 25 clipped to 3 x 25");
  await deliver(store, classicInvoice({ id: "evt_c2", subscription: "sub_1", priceId: "price_starter", billingReason: "subscription_cycle" }));
  assert.equal(store.orgs.get(7)!.creditsBalance, 75, "already at the cap: nothing added, nothing removed");
  const renewals = store.billingEvents.filter((row) => row.kind === "subscription_renewed");
  assert.equal(renewals.length, 2, "face value is recorded for every paid period");
  assert.equal(grantsFor(store, "subscription_grant").length, 1, "no zero-delta ledger rows");
});

test("proration invoice (billing_reason subscription_update) grants nothing but syncs the plan", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", creditsBalance: 20 })]);
  const statuses = await deliver(
    store,
    classicInvoice({ subscription: "sub_1", priceId: "price_growth", billingReason: "subscription_update", amountPaid: 15000 }),
  );
  assert.deepEqual(statuses, [200]);
  const org = store.orgs.get(7)!;
  assert.equal(org.creditsBalance, 20, "proration grants no credits");
  assert.equal(org.plan, "growth", "plan follows the billed price");
  assert.equal(store.ledger.length, 0);
  assert.ok(store.audits.some((row) => row.eventType === "org_plan_changed"));
});

test("renewal of an upgraded subscription grants the quota of the price actually billed", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", creditsBalance: 0 })]);
  await deliver(store, classicInvoice({ subscription: "sub_1", priceId: "price_growth", billingReason: "subscription_cycle" }));
  assert.equal(store.orgs.get(7)!.creditsBalance, GROWTH_MONTHLY_CREDITS);
  assert.equal(store.orgs.get(7)!.plan, "growth");
});

test("invoice with an unmappable price and no plan hint fails loudly (500) instead of guessing", async () => {
  const store = makeStore([makeOrg({ plan: "trial", stripeSubscriptionId: "sub_1" })]);
  const result = await billing.runStripeWebhookEvent(
    classicInvoice({ subscription: "sub_1", priceId: "price_unknown", billingReason: "subscription_cycle" }),
    store,
  );
  assert.equal(result.status, 500);
  assert.equal(store.ledger.length, 0);
});

/* ————— Packs only when paid ————— */

test("credit pack on a trial org: granted only when paid, sets payg and first_paid_at", async () => {
  const store = makeStore([makeOrg({ plan: "trial", creditsBalance: 1 })]);
  const [unpaid] = await deliver(store, checkoutCompleted({ id: "evt_unpaid", orgId: 7, product: "credit_pack", paymentStatus: "unpaid" }));
  assert.equal(unpaid, 200);
  assert.equal(store.orgs.get(7)!.creditsBalance, 1, "unpaid checkout grants nothing");
  assert.equal(store.orgs.get(7)!.plan, "trial");

  const [paidLater] = await deliver(
    store,
    event("evt_async_ok", "checkout.session.async_payment_succeeded", {
      id: "cs_1",
      object: "checkout.session",
      payment_status: "paid",
      amount_total: 5900,
      metadata: { organizationId: "7", product: "credit_pack" },
    }),
  );
  assert.equal(paidLater, 200);
  const org = store.orgs.get(7)!;
  assert.equal(org.creditsBalance, 1 + CREDIT_PACK_AMOUNT);
  assert.equal(org.plan, "payg", "a pack on a trial org is pay as you go");
  assert.equal(org.firstPaidAt?.toISOString(), FIXED_NOW.toISOString());
  assert.ok(store.audits.some((row) => row.eventType === "org_plan_changed"));
});

test("async payment failure records payment_failed without touching credits", async () => {
  const store = makeStore([makeOrg({ plan: "trial", creditsBalance: 2 })]);
  await deliver(
    store,
    event("evt_async_fail", "checkout.session.async_payment_failed", {
      id: "cs_1",
      object: "checkout.session",
      payment_status: "unpaid",
      amount_total: 5900,
      metadata: { organizationId: "7", product: "credit_pack" },
    }),
  );
  assert.equal(store.orgs.get(7)!.creditsBalance, 2);
  assert.ok(store.billingEvents.some((row) => row.kind === "payment_failed"));
  assert.ok(store.funnelEvents.some((row) => row.event === "payment_failed"));
});

test("checkout for a foreign product on the same Stripe account is ignored", async () => {
  const store = makeStore([makeOrg()]);
  const result = await billing.runStripeWebhookEvent(
    event("evt_foreign", "checkout.session.completed", { id: "cs_9", metadata: {} }),
    store,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.handled, "ignored_foreign_checkout");
});

/* ————— Lifecycle ————— */

test("customer.subscription.updated maps price -> plan, status and cancel_at_period_end", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", creditsBalance: 10 })]);
  await deliver(
    store,
    event("evt_sub_upd", "customer.subscription.updated",
      subscriptionObject({ id: "sub_1", status: "past_due", priceId: "price_growth", cancelAtPeriodEnd: true, periodEnd: 1_770_000_000 })),
  );
  const org = store.orgs.get(7)!;
  assert.equal(org.plan, "growth");
  assert.equal(org.subscriptionStatus, "past_due");
  assert.equal(org.cancelAtPeriodEnd, true);
  assert.equal(org.billingPeriodEnd?.getTime(), 1_770_000_000 * 1000);
  assert.equal(org.creditsBalance, 10, "plan change grants nothing by itself");
  assert.ok(store.billingEvents.some((row) => row.kind === "subscription_updated" && row.plan === "growth"));
});

test("customer.subscription.paused / resumed mirror the status", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" })]);
  await deliver(store, event("evt_pause", "customer.subscription.paused", subscriptionObject({ id: "sub_1", status: "paused", priceId: "price_starter" })));
  assert.equal(store.orgs.get(7)!.subscriptionStatus, "paused");
  await deliver(store, event("evt_resume", "customer.subscription.resumed", subscriptionObject({ id: "sub_1", status: "active", priceId: "price_starter" })));
  assert.equal(store.orgs.get(7)!.subscriptionStatus, "active");
});

test("invoice.payment_failed marks the subscription past_due and records the event", async () => {
  const store = makeStore([makeOrg({ plan: "growth", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", creditsBalance: 40 })]);
  await deliver(
    store,
    event("evt_fail", "invoice.payment_failed", {
      id: "in_f",
      object: "invoice",
      customer: "cus_7",
      subscription: "sub_1",
      billing_reason: "subscription_cycle",
      amount_due: 27900,
      lines: { data: [] },
    }),
  );
  const org = store.orgs.get(7)!;
  assert.equal(org.subscriptionStatus, "past_due");
  assert.equal(org.plan, "growth", "plan is kept while Stripe retries the card");
  assert.equal(org.creditsBalance, 40);
  assert.ok(store.billingEvents.some((row) => row.kind === "payment_failed" && row.amountCents === 27900));
  assert.ok(store.funnelEvents.some((row) => row.event === "payment_failed"));
});

test("customer.subscription.deleted: payg when credits remain, churned_at set, credits kept", async () => {
  const store = makeStore([makeOrg({ plan: "growth", stripeSubscriptionId: "sub_1", subscriptionStatus: "active", creditsBalance: 12, billingPeriodEnd: new Date() })]);
  await deliver(store, event("evt_del", "customer.subscription.deleted", subscriptionObject({ id: "sub_1", status: "canceled", priceId: "price_growth" })));
  const org = store.orgs.get(7)!;
  assert.equal(org.plan, "payg");
  assert.equal(org.creditsBalance, 12, "credits are never removed");
  assert.equal(org.stripeSubscriptionId, null);
  assert.equal(org.billingPeriodEnd, null);
  assert.equal(org.subscriptionStatus, "canceled");
  assert.equal(org.churnedAt?.toISOString(), FIXED_NOW.toISOString());
  assert.ok(store.billingEvents.some((row) => row.kind === "subscription_canceled" && row.plan === "growth"));
  assert.ok(store.funnelEvents.some((row) => row.event === "subscription_canceled"));
});

test("customer.subscription.deleted with an empty balance lands on plan none", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_1", creditsBalance: 0 })]);
  await deliver(store, event("evt_del0", "customer.subscription.deleted", subscriptionObject({ id: "sub_1", status: "canceled", priceId: "price_starter" })));
  assert.equal(store.orgs.get(7)!.plan, "none");
});

test("stale deletion of a replaced subscription does not churn the live plan", async () => {
  const store = makeStore([makeOrg({ plan: "starter", stripeSubscriptionId: "sub_new", creditsBalance: 5 })]);
  const result = await billing.runStripeWebhookEvent(
    event("evt_del_old", "customer.subscription.deleted",
      subscriptionObject({ id: "sub_old", status: "canceled", priceId: "price_starter", orgId: 7 })),
    store,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.handled, "ignored_stale_subscription_deleted");
  assert.equal(store.orgs.get(7)!.plan, "starter");
  assert.equal(store.orgs.get(7)!.stripeSubscriptionId, "sub_new");
});

test("deletion of a subscription we never knew about is ignored, not a 500", async () => {
  const store = makeStore([makeOrg()]);
  const result = await billing.runStripeWebhookEvent(
    event("evt_del_unknown", "customer.subscription.deleted", { id: "sub_zzz", object: "subscription", customer: "cus_unknown", metadata: {} }),
    store,
  );
  assert.equal(result.status, 200);
  assert.equal(store.orgs.get(7)!.plan, "trial");
});

test("subscription resumed after cancellation on the same org re-activates and clears churned_at", async () => {
  const store = makeStore([makeOrg({ plan: "payg", creditsBalance: 4, churnedAt: new Date("2026-09-01"), subscriptionStatus: "canceled" })]);
  await deliver(
    store,
    checkoutCompleted({ id: "evt_co2", orgId: 7, product: "starter", subscription: "sub_2" }),
    classicInvoice({ id: "evt_inv2", subscription: "sub_2", priceId: "price_starter", billingReason: "subscription_create" }),
  );
  const org = store.orgs.get(7)!;
  assert.equal(org.plan, "starter");
  assert.equal(org.churnedAt, null);
  assert.equal(org.stripeSubscriptionId, "sub_2");
  assert.equal(org.creditsBalance, 4 + STARTER_MONTHLY_CREDITS);
});

test("mapSubscriptionStatus collapses Stripe statuses onto the org enum", () => {
  assert.equal(billing.mapSubscriptionStatus("active"), "active");
  assert.equal(billing.mapSubscriptionStatus("trialing"), "active");
  assert.equal(billing.mapSubscriptionStatus("past_due"), "past_due");
  assert.equal(billing.mapSubscriptionStatus("unpaid"), "past_due");
  assert.equal(billing.mapSubscriptionStatus("paused"), "paused");
  assert.equal(billing.mapSubscriptionStatus("canceled"), "canceled");
  assert.equal(billing.mapSubscriptionStatus("incomplete_expired"), "canceled");
  assert.equal(billing.mapSubscriptionStatus("made_up"), null);
});

/* ————— Stripe shape helpers ————— */

test("stripe shape readers accept both classic and basil payloads", () => {
  assert.equal(stripeLib.invoiceSubscriptionId({ subscription: "sub_a" }), "sub_a");
  assert.equal(stripeLib.invoiceSubscriptionId({ subscription: { id: "sub_b" } }), "sub_b");
  assert.equal(stripeLib.invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_c" } } }), "sub_c");
  assert.equal(stripeLib.invoiceSubscriptionId({ parent: null, subscription: null }), null);
  assert.deepEqual(stripeLib.invoiceLinePriceIds({ lines: { data: [{ price: { id: "p1" } }, { pricing: { price_details: { price: "p2" } } }] } }), ["p1", "p2"]);
  assert.deepEqual(stripeLib.invoiceSubscriptionMetadata({ subscription_details: { metadata: { organizationId: "3", n: 1 } } }), { organizationId: "3" });
  assert.deepEqual(stripeLib.invoiceSubscriptionMetadata({ parent: { subscription_details: { metadata: { product: "growth" } } } }), { product: "growth" });
  assert.equal(stripeLib.invoicePeriodEnd({ lines: { data: [{ period: { end: 5 } }, { period: { end: 9 } }] } }), 9);
  assert.equal(stripeLib.invoicePeriodEnd({ lines: { data: [] }, period_end: 4 }), 4);
  assert.equal(stripeLib.subscriptionPeriodEnd({ items: { data: [{ current_period_end: 11 }] } }), 11);
  assert.equal(stripeLib.productForPriceId("price_growth"), "growth");
  assert.equal(stripeLib.productForPriceId("price_pack"), "credit_pack");
  assert.equal(stripeLib.productForPriceId("nope"), null);
  assert.equal(stripeLib.productForPriceId(""), null);
  assert.equal(stripeLib.organizationIdFromMetadata({ organizationId: "12" }), 12);
  assert.equal(stripeLib.organizationIdFromMetadata({ organizationId: "abc" }), null);
  assert.equal(stripeLib.organizationIdFromMetadata(undefined), null);
  assert.equal(stripeLib.planCreditRolloverCap({ PLAN_CREDIT_ROLLOVER_CAP: "2" }), 2);
  assert.equal(stripeLib.planCreditRolloverCap({ PLAN_CREDIT_ROLLOVER_CAP: "0" }), 3);
  assert.equal(stripeLib.planCreditRolloverCap({}), 3);
  assert.equal(stripeLib.isStripeConfigured(), false, "no secret key in the test env");
});

/* ————— Trial provisioning (E5: once per Clerk user) ————— */

type ProvisioningStore = import("../lib/orgAuth.js").OrgProvisioningStore;
type ProvisionedOrg = import("../lib/orgAuth.js").ProvisionedOrg;

interface FakeProvisioning extends ProvisioningStore {
  orgs: ProvisionedOrg[];
  trialEndsAt: Map<number, Date>;
  ledger: Array<{ organizationId: number; delta: number; reason: string }>;
  billingEvents: Array<Record<string, unknown>>;
  funnelEvents: Array<Record<string, unknown>>;
}

function makeProvisioning(seed: ProvisionedOrg[] = []): FakeProvisioning {
  let nextId = seed.reduce((max, org) => Math.max(max, org.id), 0) + 1;
  const store: FakeProvisioning = {
    orgs: seed.map((org) => ({ ...org })),
    trialEndsAt: new Map(),
    ledger: [],
    billingEvents: [],
    funnelEvents: [],
    async findByClerkOrgId(clerkOrgId) {
      const org = store.orgs.find((row) => row.clerkOrgId === clerkOrgId);
      return org ? { ...org } : null;
    },
    async insertIfAbsent(values) {
      const existing = store.orgs.find((row) => row.clerkOrgId === values.clerkOrgId);
      if (existing) return { org: { ...existing }, created: false };
      const org: ProvisionedOrg = {
        id: nextId++,
        clerkOrgId: values.clerkOrgId,
        name: values.name,
        plan: "trial",
        creditsBalance: 0,
        trialGrantedByClerkUserId: null,
      };
      store.orgs.push(org);
      store.trialEndsAt.set(org.id, values.trialEndsAt);
      return { org: { ...org }, created: true };
    },
    async claimTrialGrant(orgId, clerkUserId, creditsToGrant) {
      const org = store.orgs.find((row) => row.id === orgId);
      if (!org) return false;
      const alreadyGranted = store.orgs.some((row) => row.trialGrantedByClerkUserId === clerkUserId);
      const hasLedger = store.ledger.some((row) => row.organizationId === orgId && row.reason === "trial_grant");
      if (org.plan !== "trial" || org.trialGrantedByClerkUserId != null || org.creditsBalance !== 0 || hasLedger || alreadyGranted) {
        return false;
      }
      org.trialGrantedByClerkUserId = clerkUserId;
      org.creditsBalance += creditsToGrant;
      return true;
    },
    async insertTrialLedger(orgId, creditsToGrant) {
      store.ledger.push({ organizationId: orgId, delta: creditsToGrant, reason: "trial_grant" });
    },
    async recordBillingTrialStarted(orgId, creditsToGrant) {
      store.billingEvents.push({ organizationId: orgId, kind: "trial_started", faceValueCredits: creditsToGrant });
    },
    async recordFunnelEvent(input) {
      store.funnelEvents.push({ ...input });
    },
  };
  return store;
}

test("a new organization gets the trial clock and one ledgered trial grant", async () => {
  const store = makeProvisioning();
  const now = new Date("2026-10-08T00:00:00Z");
  const result = await orgAuth.provisionOrganization(store, {
    clerkOrgId: "org_clerk_1",
    name: "Rustic",
    clerkUserId: "user_a",
    trialDays: 14,
    now,
  });
  assert.equal(result.created, true);
  assert.equal(result.trialGranted, true);
  assert.equal(result.org.creditsBalance, TRIAL_CREDITS);
  assert.equal(result.org.trialGrantedByClerkUserId, "user_a");
  assert.equal(store.trialEndsAt.get(result.org.id)?.toISOString(), "2026-10-22T00:00:00.000Z");
  assert.deepEqual(store.ledger, [{ organizationId: result.org.id, delta: TRIAL_CREDITS, reason: "trial_grant" }]);
  assert.equal(store.billingEvents.length, 1);
  assert.deepEqual(store.funnelEvents.map((row) => row.event), ["org_created", "trial_started"]);
});

test("the same Clerk user does not get a second trial on a second organization", async () => {
  const store = makeProvisioning();
  await orgAuth.provisionOrganization(store, { clerkOrgId: "org_1", clerkUserId: "user_a", trialDays: 14 });
  const second = await orgAuth.provisionOrganization(store, { clerkOrgId: "org_2", clerkUserId: "user_a", trialDays: 14 });
  assert.equal(second.created, true);
  assert.equal(second.trialGranted, false);
  assert.equal(second.org.creditsBalance, 0, "second org starts unfunded");
  assert.equal(store.ledger.length, 1);
  assert.equal(store.funnelEvents.filter((row) => row.event === "trial_started").length, 1);
});

test("webhook-first provisioning without a user is funded on the member's first signed-in touch, once", async () => {
  const store = makeProvisioning();
  const fromWebhook = await orgAuth.provisionOrganization(store, { clerkOrgId: "org_1", name: "Hudson", clerkUserId: null });
  assert.equal(fromWebhook.created, true);
  assert.equal(fromWebhook.trialGranted, false);
  assert.equal(fromWebhook.org.creditsBalance, 0);

  const firstTouch = await orgAuth.provisionOrganization(store, { clerkOrgId: "org_1", clerkUserId: "user_b" });
  assert.equal(firstTouch.created, false);
  assert.equal(firstTouch.trialGranted, true);
  assert.equal(firstTouch.org.creditsBalance, TRIAL_CREDITS);

  const again = await orgAuth.provisionOrganization(store, { clerkOrgId: "org_1", clerkUserId: "user_b" });
  assert.equal(again.trialGranted, false);
  assert.equal(store.ledger.length, 1);
});

test("a second member signing into an already-funded org gets nothing extra", async () => {
  const store = makeProvisioning();
  await orgAuth.provisionOrganization(store, { clerkOrgId: "org_1", clerkUserId: "user_a" });
  const other = await orgAuth.provisionOrganization(store, { clerkOrgId: "org_1", clerkUserId: "user_c" });
  assert.equal(other.trialGranted, false);
  assert.equal(other.org.creditsBalance, TRIAL_CREDITS);
});

test("legacy org rows that already hold credits are never re-granted", async () => {
  const store = makeProvisioning([
    { id: 1, clerkOrgId: "org_legacy", name: "Legacy", plan: "trial", creditsBalance: 5, trialGrantedByClerkUserId: null },
  ]);
  const result = await orgAuth.provisionOrganization(store, { clerkOrgId: "org_legacy", clerkUserId: "user_z" });
  assert.equal(result.trialGranted, false);
  assert.equal(result.org.creditsBalance, 5);
  assert.equal(store.ledger.length, 0);
});

test("fetchName is used only when the caller has no name", async () => {
  const store = makeProvisioning();
  let calls = 0;
  const result = await orgAuth.provisionOrganization(store, {
    clerkOrgId: "org_n",
    fetchName: async () => {
      calls += 1;
      return "From Clerk";
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.org.name, "From Clerk");
});

/* ————— Clerk email + origin policy ————— */

test("pickVerifiedEmail prefers the verified primary, then any verified address, never an unverified one", () => {
  const emails = [
    { id: "e1", emailAddress: "Unverified@Example.com", verification: { status: "unverified" } },
    { id: "e2", emailAddress: "Second@Example.com", verification: { status: "verified" } },
    { id: "e3", emailAddress: "Primary@Example.com", verification: { status: "verified" } },
  ];
  const idOf = (email: { id?: string; emailAddress: string }) => email.id ?? null;
  assert.equal(orgAuth.pickVerifiedEmail(emails, "e3", idOf), "primary@example.com");
  assert.equal(orgAuth.pickVerifiedEmail(emails, "e1", idOf), "second@example.com", "unverified primary falls back to a verified address");
  assert.equal(orgAuth.pickVerifiedEmail([emails[0]!], "e1", idOf), null);
  assert.equal(orgAuth.pickVerifiedEmail([], null, idOf), null);
});

test("production owner mutations accept a configured origin or the request host, and reject the rest", () => {
  const prevEnv = process.env.NODE_ENV;
  const prevOrigins = process.env.CORS_ALLOWED_ORIGINS;
  process.env.NODE_ENV = "production";
  process.env.CORS_ALLOWED_ORIGINS = "https://dreemer.co";
  try {
    const allowed = (headers: Record<string, string>) =>
      orgAuth.isOwnerMutationOriginAllowed({ method: "POST", headers } as never);
    assert.equal(allowed({ host: "dreemer.co", origin: "https://dreemer.co" }), true, "configured origin");
    assert.equal(allowed({ host: "www.dreemer.co", origin: "https://www.dreemer.co" }), true, "origin host equals request host (www variant)");
    assert.equal(allowed({ host: "app.example.com", referer: "https://app.example.com/dashboard" }), true, "referer host equals request host");
    assert.equal(allowed({ host: "dreemer.co", origin: "https://evil.example" }), false, "foreign origin");
    assert.equal(allowed({ host: "dreemer.co", "x-forwarded-host": "localhost", origin: "http://localhost:3000" }), false, "no loopback carve-out via X-Forwarded-Host in production");
    assert.equal(allowed({ host: "dreemer.co" }), false, "no origin and no referer");
    assert.equal(orgAuth.isOwnerMutationOriginAllowed({ method: "GET", headers: {} } as never), true, "safe methods pass");
  } finally {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevOrigins === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = prevOrigins;
  }
});

test("requireOrgAdmin is true only for org:admin", () => {
  assert.equal(orgAuth.requireOrgAdmin({ orgRole: "org:admin" }), true);
  assert.equal(orgAuth.requireOrgAdmin({ orgRole: "org:member" }), false);
  assert.equal(orgAuth.requireOrgAdmin({ orgRole: null }), false);
});

test("isUniqueViolation recognises the trial-grantee index, including wrapped driver errors", () => {
  const pgError = Object.assign(new Error("duplicate key"), {
    code: "23505",
    constraint: "organizations_trial_grantee_unique",
  });
  assert.equal(orgAuth.isUniqueViolation(pgError, "organizations_trial_grantee_unique"), true);
  assert.equal(
    orgAuth.isUniqueViolation(new Error("query failed", { cause: pgError }), "organizations_trial_grantee_unique"),
    true,
  );
  assert.equal(orgAuth.isUniqueViolation(pgError, "organizations_clerk_org_id_unique"), false);
  assert.equal(orgAuth.isUniqueViolation(new Error("boom"), "organizations_trial_grantee_unique"), false);
});
