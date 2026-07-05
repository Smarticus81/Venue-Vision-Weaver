import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { venuesTable } from "./venues";
import { coupleSessionsTable } from "./sessions";

export const CREDIT_REASONS = [
  "trial_grant",
  "subscription_grant",
  "pack_purchase",
  "session_debit",
  "session_refund",
  "admin_adjust",
] as const;

export type CreditReason = (typeof CREDIT_REASONS)[number];

export const creditTransactionsTable = pgTable(
  "credit_transactions",
  {
    id: serial("id").primaryKey(),
    // Ledger rows belong to the billing organization; venueId records which
    // venue triggered the movement when one did (debits/refunds).
    organizationId: integer("organization_id"),
    venueId: integer("venue_id").references(() => venuesTable.id, {
      onDelete: "cascade",
    }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    sessionId: integer("session_id").references(() => coupleSessionsTable.id, {
      onDelete: "set null",
    }),
    // Unique id of the upstream billing event (Clerk webhook message id, or a
    // legacy Stripe event id) — the idempotency key for grants.
    stripeEventId: text("stripe_event_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    stripeEventIdUnique: uniqueIndex("credit_transactions_stripe_event_id_unique").on(
      table.stripeEventId,
    ).where(sql`${table.stripeEventId} IS NOT NULL`),
  }),
);

export type CreditTransaction = typeof creditTransactionsTable.$inferSelect;
