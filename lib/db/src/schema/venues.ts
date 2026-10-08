import { pgTable, text, serial, timestamp, integer, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";
import { TRIAL_CREDITS } from "./plans";

/** Legacy per-venue plan column; billing is organizational. Kept aligned with ORG_PLANS. */
export const VENUE_PLANS = ["trial", "starter", "growth", "payg", "none"] as const;
export type VenuePlan = (typeof VENUE_PLANS)[number];

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
  organizationId: integer("organization_id").references(() => organizationsTable.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tagline: text("tagline"),
  description: text("description"),
  ownerEmail: text("owner_email").notNull(),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  websiteUrl: text("website_url"),
  bookingUrl: text("booking_url"),
  /** One line the venue may show under the reel on the share page ("Hold your date with a $500 deposit through June"). */
  incentiveText: text("incentive_text"),
  /** Onboarding checklist: when the owner downloaded the printable tour card (QR). */
  tourCardDownloadedAt: timestamp("tour_card_downloaded_at"),
  /** Onboarding: when photos were last imported from websiteUrl. */
  websiteImportedAt: timestamp("website_imported_at"),
  /** When true, ready galleries wait for the owner instead of auto-delivering to the couple. */
  reviewBeforeSend: boolean("review_before_send").notNull().default(false),
  plan: text("plan").notNull().default("trial"),
  creditsBalance: integer("credits_balance").notNull().default(TRIAL_CREDITS),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  billingPeriodEnd: timestamp("billing_period_end"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

export const venueMediaTable = pgTable(
  "venue_media",
  {
    id: serial("id").primaryKey(),
    venueId: integer("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    coverage: text("coverage").notNull().default("detail"),
    displayOrder: integer("display_order").notNull().default(0),
    /** Perceptual hash (hex) for near-duplicate detection; null for rows uploaded before hashing. */
    perceptualHash: text("perceptual_hash"),
    width: integer("width"),
    height: integer("height"),
    contentType: text("content_type"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    venueObjectKeyUnique: uniqueIndex("venue_media_venue_object_key_unique").on(
      table.venueId,
      table.objectKey,
    ),
  }),
).enableRLS();

export type Venue = typeof venuesTable.$inferSelect;
export type InsertVenue = typeof venuesTable.$inferInsert;
export type VenueMedia = typeof venueMediaTable.$inferSelect;
export type InsertVenueMedia = typeof venueMediaTable.$inferInsert;
