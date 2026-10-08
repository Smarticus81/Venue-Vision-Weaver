import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";
import { venuesTable } from "./venues";
import { coupleSessionsTable } from "./sessions";

export const CREDIT_REASONS = [
  "trial_grant",
  "subscription_grant",
  "pack_purchase",
  "session_debit",
  "session_refund",
  "requeue_grant",
  "admin_adjust",
] as const;

export type CreditReason = (typeof CREDIT_REASONS)[number];

export const creditTransactionsTable = pgTable(
  "credit_transactions",
  {
    id: serial("id").primaryKey(),
    // Ledger rows belong to the billing organization; venueId records which
    // venue triggered the movement when one did (debits/refunds).
    organizationId: integer("organization_id").references(() => organizationsTable.id),
    venueId: integer("venue_id").references(() => venuesTable.id, {
      onDelete: "cascade",
    }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    sessionId: integer("session_id").references(() => coupleSessionsTable.id, {
      onDelete: "set null",
    }),
    // Unique id of the upstream Stripe event that granted the credits — the
    // idempotency key for grants.
    stripeEventId: text("stripe_event_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    stripeEventIdUnique: uniqueIndex("credit_transactions_stripe_event_id_unique").on(
      table.stripeEventId,
    ).where(sql`${table.stripeEventId} IS NOT NULL`),
  }),
).enableRLS();

/** Every Stripe webhook event id we have processed (recorded before acting; the webhook idempotency log). */
export const stripeEventsTable = pgTable("stripe_events", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
}).enableRLS();

export const BILLING_EVENT_KINDS = [
  "subscription_started",
  "subscription_renewed",
  "subscription_updated",
  "subscription_canceled",
  "pack_purchased",
  "payment_failed",
  "trial_started",
] as const;
export type BillingEventKind = (typeof BILLING_EVENT_KINDS)[number];

/** Business-level billing history per organization (what happened, which plan, face value, amount). */
export const billingEventsTable = pgTable(
  "billing_events",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organizationsTable.id),
    kind: text("kind").notNull(),
    plan: text("plan"),
    faceValueCredits: integer("face_value_credits"),
    amountCents: integer("amount_cents"),
    stripeEventId: text("stripe_event_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    orgIdx: index("billing_events_org_idx").on(table.organizationId, table.createdAt),
  }),
).enableRLS();

export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
export type StripeEvent = typeof stripeEventsTable.$inferSelect;
export type BillingEvent = typeof billingEventsTable.$inferSelect;
export type InsertBillingEvent = typeof billingEventsTable.$inferInsert;
