import { invoiceSubscriptionId } from "./stripe.js";

export const BILLING_RISK_EVENTS = [
  "charge.refunded",
  "charge.dispute.created",
  "radar.early_fraud_warning.created",
] as const;

export function isBillingRiskEvent(type: string): boolean {
  return (BILLING_RISK_EVENTS as readonly string[]).includes(type);
}

type Event = { id: string; type: string; data: { object: unknown } };
export interface BillingRiskReview {
  eventId: string;
  eventType: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  customerId: string | null;
  invoiceIds: string[];
  subscriptionIds: string[];
  organizationIds: number[];
  amountCents: number | null;
  amountBasis: "cumulative_refunded" | "disputed" | "flagged_charge";
  currency: string | null;
  reason: string | null;
  evidenceDueAt: string | null;
  mappingNeedsReview: boolean;
}

export interface BillingRiskStore {
  retrieveCharge(id: string): Promise<unknown>;
  retrieveInvoice(id: string): Promise<unknown>;
  /** Must follow every page; one PaymentIntent can pay multiple invoices. */
  listPaidInvoiceIds(paymentIntentId: string): Promise<string[]>;
  findOrgByCustomerId(id: string): Promise<{ id: number } | null>;
  findOrgBySubscriptionId(id: string): Promise<{ id: number } | null>;
  /** Atomically claims stripe_events and inserts the human task + audit entry. */
  recordRiskReview(event: Event, review: BillingRiskReview): Promise<boolean>;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
function id(value: unknown): string | null {
  const candidate = typeof value === "string" ? value : record(value).id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 300) : null;
}
function amount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Read-only Stripe resolution followed by one atomic human-review write.
 * No metadata ownership guesses, refunds, credit changes, cancellations or mail.
 * API failures throw, so Stripe retries instead of silently losing a risk event.
 */
export async function handleBillingRiskEvent(event: Event, store: BillingRiskStore) {
  if (!isBillingRiskEvent(event.type)) throw new Error("Unsupported billing risk event");
  const object = record(event.data.object);
  const chargeId = event.type === "charge.refunded" ? id(object) : id(object.charge);
  const charge = event.type === "charge.refunded"
    ? object
    : chargeId ? record(await store.retrieveCharge(chargeId)) : {};
  const paymentIntentId = id(object.payment_intent) ?? id(charge.payment_intent);
  const customerId = id(charge.customer);
  const invoiceIds = new Set<string>();
  // Pre-basil webhooks include charge.invoice; current API uses InvoicePayments.
  const legacyInvoice = id(charge.invoice);
  if (legacyInvoice) invoiceIds.add(legacyInvoice);
  if (paymentIntentId) {
    for (const invoiceId of await store.listPaidInvoiceIds(paymentIntentId)) invoiceIds.add(invoiceId);
  }
  const subscriptionIds = new Set<string>();
  const organizationIds = new Set<number>();
  let unresolvedSubscription = false;
  for (const invoiceId of invoiceIds) {
    const invoice = await store.retrieveInvoice(invoiceId);
    const subscriptionId = invoiceSubscriptionId(invoice);
    if (!subscriptionId) continue;
    subscriptionIds.add(subscriptionId);
    const org = await store.findOrgBySubscriptionId(subscriptionId);
    if (org) organizationIds.add(org.id);
    else unresolvedSubscription = true;
  }
  if (customerId) {
    const org = await store.findOrgByCustomerId(customerId);
    if (org) organizationIds.add(org.id);
  }
  const due = record(object.evidence_details).due_by;
  const dueDate = typeof due === "number" ? new Date(due * 1000) : null;
  const review: BillingRiskReview = {
    eventId: event.id, eventType: event.type, chargeId, paymentIntentId, customerId,
    invoiceIds: [...invoiceIds], subscriptionIds: [...subscriptionIds], organizationIds: [...organizationIds],
    amountCents: amount(event.type === "charge.refunded" ? object.amount_refunded : object.amount ?? charge.amount),
    amountBasis: event.type === "charge.refunded" ? "cumulative_refunded"
      : event.type === "charge.dispute.created" ? "disputed" : "flagged_charge",
    currency: text(object.currency ?? charge.currency),
    reason: text(object.reason ?? object.fraud_type),
    evidenceDueAt: dueDate && Number.isFinite(dueDate.getTime()) ? dueDate.toISOString() : null,
    mappingNeedsReview: organizationIds.size !== 1 || unresolvedSubscription,
  };
  const fresh = await store.recordRiskReview(event, review);
  return {
    handled: fresh ? "billing_risk_review_created" : "billing_risk_review_duplicate",
    ...(organizationIds.size === 1 ? { organizationId: [...organizationIds][0] } : {}),
    ...(!fresh ? { duplicate: true } : {}),
  };
}
