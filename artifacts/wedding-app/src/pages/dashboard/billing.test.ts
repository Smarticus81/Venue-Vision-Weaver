import { test } from "node:test";
import assert from "node:assert/strict";
import {
  billingChanged,
  billingGuard,
  buildBillingCards,
  checkoutConflictUrl,
  creditReasonLabel,
  pollAttempts,
} from "./billing.ts";
import { DEFAULT_PUBLIC_CONFIG } from "./publicConfig.ts";

test("billing cards come from the published prices, never a constant", () => {
  const cards = buildBillingCards({
    ...DEFAULT_PUBLIC_CONFIG,
    pricing: { ...DEFAULT_PUBLIC_CONFIG.pricing, starterMonthly: 150, starterCredits: 30, creditPack: 40 },
  });
  const starter = cards.find((c) => c.id === "starter")!;
  assert.equal(starter.price, "$150 a month");
  assert.equal(starter.credits, "30 galleries a month");
  assert.equal(starter.perGallery, "$5 per gallery");
  const pack = cards.find((c) => c.id === "credit_pack")!;
  assert.equal(pack.price, "$40 one time");
  assert.equal(pack.kind, "pack");
  assert.equal(cards.filter((c) => c.recommended).length, 1);
  assert.equal(cards.find((c) => c.recommended)!.id, "growth");
});

test("billingGuard: trial org sees Start buttons, live only for admins with Stripe", () => {
  const live = billingGuard({ product: "starter", plan: "trial", isAdmin: true, billingConfigured: true });
  assert.deepEqual(live, { label: "Start Starter", disabled: false, reason: null, current: false, viaPortal: false });
  const member = billingGuard({ product: "growth", plan: "trial", isAdmin: false, billingConfigured: true });
  assert.equal(member.disabled, true);
  assert.match(member.reason!, /admins/);
  const noStripe = billingGuard({ product: "credit_pack", plan: "trial", isAdmin: true, billingConfigured: false });
  assert.equal(noStripe.disabled, true);
  assert.match(noStripe.reason!, /not set up/);
  assert.equal(noStripe.label, "Add 10 credits");
});

test("billingGuard: a subscribed org switches plans through the portal and keeps packs direct", () => {
  const current = billingGuard({ product: "starter", plan: "starter", isAdmin: true, billingConfigured: true });
  assert.equal(current.label, "Current plan");
  assert.equal(current.disabled, true);
  assert.equal(current.current, true);
  const switchPlan = billingGuard({ product: "growth", plan: "starter", isAdmin: true, billingConfigured: true });
  assert.equal(switchPlan.label, "Switch plan");
  assert.equal(switchPlan.viaPortal, true);
  assert.equal(switchPlan.disabled, false);
  const pack = billingGuard({ product: "credit_pack", plan: "growth", isAdmin: true, billingConfigured: true });
  assert.equal(pack.viaPortal, false);
  const resuming = billingGuard({ product: "starter", plan: "starter", isAdmin: true, billingConfigured: true, cancelAtPeriodEnd: true });
  assert.equal(resuming.label, "Resume plan");
  assert.equal(resuming.disabled, false);
});

test("billingGuard: pay-as-you-go orgs can start a plan directly", () => {
  const g = billingGuard({ product: "growth", plan: "payg", isAdmin: true, billingConfigured: true });
  assert.equal(g.label, "Start Growth");
  assert.equal(g.viaPortal, false);
});

test("checkoutConflictUrl reads the 409 subscription_exists portal url only", () => {
  const conflict = { status: 409, data: { error: "exists", code: "subscription_exists", url: "https://billing.stripe.com/p/session_123" } };
  assert.equal(checkoutConflictUrl(conflict), "https://billing.stripe.com/p/session_123");
  assert.equal(checkoutConflictUrl({ status: 409, data: { error: "x", code: "other", url: "https://x" } }), null);
  assert.equal(checkoutConflictUrl({ status: 409, data: { code: "subscription_exists", url: "http://insecure" } }), null);
  assert.equal(checkoutConflictUrl({ status: 500, data: { code: "subscription_exists", url: "https://x" } }), null);
  assert.equal(checkoutConflictUrl(new Error("boom")), null);
});

test("credit reasons read as plain words", () => {
  assert.equal(creditReasonLabel("trial_grant"), "Free trial");
  assert.equal(creditReasonLabel("session_debit"), "Gallery");
  assert.equal(creditReasonLabel("pack_purchase"), "Credit pack");
  assert.equal(creditReasonLabel("something_new"), "something new");
});

test("billingChanged and pollAttempts drive the post-checkout confirmation", () => {
  const before = { plan: "trial", creditsBalance: 2, billingPeriodEnd: null };
  assert.equal(billingChanged(before, { ...before }), false);
  assert.equal(billingChanged(before, { ...before, creditsBalance: 12 }), true);
  assert.equal(billingChanged(before, { ...before, plan: "starter" }), true);
  assert.equal(billingChanged(before, { ...before, billingPeriodEnd: "2026-11-08" }), true);
  assert.equal(pollAttempts(3000, 30_000), 10);
  assert.equal(pollAttempts(0, 30_000), 0);
  assert.equal(pollAttempts(60_000, 30_000), 1);
});
