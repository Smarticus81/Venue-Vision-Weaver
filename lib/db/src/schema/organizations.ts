import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { TRIAL_CREDITS } from "./venues";

export const ORG_PLANS = ["trial", "starter", "growth", "none"] as const;
export type OrgPlan = (typeof ORG_PLANS)[number];

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
  billingPeriodEnd: timestamp("billing_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = typeof organizationsTable.$inferInsert;
