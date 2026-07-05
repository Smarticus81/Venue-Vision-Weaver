import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const VENUE_PLANS = ["trial", "starter", "growth", "none"] as const;
export type VenuePlan = (typeof VENUE_PLANS)[number];

export const TRIAL_CREDITS = 5;
export const STARTER_MONTHLY_CREDITS = 25;
export const GROWTH_MONTHLY_CREDITS = 100;
export const CREDIT_PACK_AMOUNT = 10;

export const VENUE_MEDIA_COVERAGES = [
  "exterior",
  "ceremony",
  "reception",
  "detail",
  "natural_light",
] as const;
export type VenueMediaCoverage = (typeof VENUE_MEDIA_COVERAGES)[number];

export const venuesTable = pgTable("venues", {
  id: serial("id").primaryKey(),
  // Billing tenant. Nullable only for pre-Clerk legacy rows; owner flows
  // adopt those into the caller's organization on first authenticated touch.
  organizationId: integer("organization_id"),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tagline: text("tagline"),
  description: text("description"),
  ownerEmail: text("owner_email").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  websiteUrl: text("website_url"),
  bookingUrl: text("booking_url"),
  plan: text("plan").notNull().default("trial"),
  creditsBalance: integer("credits_balance").notNull().default(TRIAL_CREDITS),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingPeriodEnd: timestamp("billing_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const venueMediaTable = pgTable(
  "venue_media",
  {
    id: serial("id").primaryKey(),
    venueId: integer("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    coverage: text("coverage").notNull().default("detail"),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    venueObjectKeyUnique: uniqueIndex("venue_media_venue_object_key_unique").on(
      table.venueId,
      table.objectKey,
    ),
  }),
);

export const insertVenueSchema = createInsertSchema(venuesTable).omit({ id: true, createdAt: true });
export const selectVenueSchema = createSelectSchema(venuesTable);

export const insertVenueMediaSchema = createInsertSchema(venueMediaTable).omit({ id: true, createdAt: true });
export const selectVenueMediaSchema = createSelectSchema(venueMediaTable);

export type Venue = typeof venuesTable.$inferSelect;
export type InsertVenue = typeof venuesTable.$inferInsert;
export type VenueMedia = typeof venueMediaTable.$inferSelect;
export type InsertVenueMedia = typeof venueMediaTable.$inferInsert;
