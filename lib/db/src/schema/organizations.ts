import { sql } from "drizzle-orm";
import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { TRIAL_CREDITS } from "./plans";

/** "payg" = pay as you go: bought a credit pack, no live subscription. */
export const ORG_PLANS = ["trial", "starter", "growth", "payg", "none"] as const;
export type OrgPlan = (typeof ORG_PLANS)[number];

/** Stripe subscription status mirrored onto the organization (null = never subscribed). */
export const ORG_SUBSCRIPTION_STATUSES = ["active", "past_due", "canceled", "paused"] as const;
export type OrgSubscriptionStatus = (typeof ORG_SUBSCRIPTION_STATUSES)[number];

/**
 * The billing tenant. One organization (backed by a Clerk Organization) owns
 * the subscription, the credit balance, and any number of venues. Members
 * sign in with their own Clerk profiles; billing never lives on a venue.
 */
export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  clerkOrgId: text("clerk_org_id").notNull().unique(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("trial"),
  creditsBalance: integer("credits_balance").notNull().default(TRIAL_CREDITS),
  // Stripe billing lives on the organization, never on a venue.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingPeriodEnd: timestamp("billing_period_end"),
  /** null | active | past_due | canceled | paused (mirrors Stripe). */
  subscriptionStatus: text("subscription_status"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  // --- growth loop (growth-loop.md 4.1) ---
  /** Best-known human contact for lifecycle email: first signed-in member email or Stripe billing email. */
  contactEmail: text("contact_email"),
  /** Trial clock. Null only for rows created before the clock existed, until the growth backfill runs. */
  trialEndsAt: timestamp("trial_ends_at"),
  /** Set once by the trial sweep when plan is still "trial" past trialEndsAt. Spending is blocked by time, not by this column. */
  trialExpiredAt: timestamp("trial_expired_at"),
  /** First subscription or credit-pack purchase. "Paid" in every KPI means this is not null. */
  firstPaidAt: timestamp("first_paid_at"),
  /** Set when a Stripe subscription is deleted. */
  churnedAt: timestamp("churned_at"),
  /** Last time the low-credit owner email went out (one per dip below the threshold). */
  lowCreditNotifiedAt: timestamp("low_credit_notified_at"),
  /** Clerk user who received this organization's one-time trial grant (trial once per person). */
  trialGrantedByClerkUserId: text("trial_granted_by_clerk_user_id"),
  /** Outreach attribution snapshot: the prospect / campaign this signup came from. */
  attributionProspectId: integer("attribution_prospect_id"),
  attributionCampaignId: integer("attribution_campaign_id"),
  // --- funnel (funnel-ux.md 2.2 / 3.4 proof row) ---
  /** Venue opted in to anonymised aggregate proof on the public site. */
  shareAggregates: boolean("share_aggregates").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Trial once per person: two organizations provisioned concurrently for the
  // same Clerk user cannot both win the trial claim.
  trialGranteeUnique: uniqueIndex("organizations_trial_grantee_unique")
    .on(table.trialGrantedByClerkUserId)
    .where(sql`${table.trialGrantedByClerkUserId} IS NOT NULL`),
})).enableRLS();

export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = typeof organizationsTable.$inferInsert;
