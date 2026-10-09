import {
  pgTable,
  text,
  serial,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { venuesTable } from "./venues";

/** "sample" sessions are owner-triggered demo renders (no couple, no credit); only "couple" counts in proof and KPIs. */
export const SESSION_KINDS = ["couple", "sample"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];
/** How the session was started. */
export const SESSION_CREATED_VIA = ["couple_link", "tour_day", "sample"] as const;
export type SessionCreatedVia = (typeof SESSION_CREATED_VIA)[number];
/** Gallery funnel events. "viewed" is written only by the server (GET by-token); "sent" by the email routes; the rest by the share page / dashboard. */
export const GALLERY_EVENT_TYPES = [
  "sent",
  "viewed",
  "shared",
  "cta_click",
  "download",
  "booked",
  "unbooked",
] as const;
export type GalleryEventType = (typeof GALLERY_EVENT_TYPES)[number];
export const GALLERY_EVENT_SOURCES = ["share_page", "email", "dashboard", "system"] as const;
export type GalleryEventSource = (typeof GALLERY_EVENT_SOURCES)[number];
/** Outcome of one render attempt recorded in render_attempts. */
export const RENDER_ATTEMPT_OUTCOMES = ["accepted", "rejected", "error", "blocked", "timeout"] as const;
export type RenderAttemptOutcome = (typeof RENDER_ATTEMPT_OUTCOMES)[number];

export const coupleSessionsTable = pgTable("couple_sessions", {
  id: serial("id").primaryKey(),
  venueId: integer("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  errorMessage: text("error_message"),
  styleId: text("style_id"),
  coupleName: text("couple_name"),
  coupleEmail: text("couple_email").notNull(),
  shareToken: text("share_token").notNull().unique(),
  creditsCharged: integer("credits_charged").notNull().default(0),
  // --- pipeline instrumentation ---
  /** When the worker picked the session up (deadline + reaper reference point). */
  startedAt: timestamp("started_at"),
  /** Owner-facing failure detail (never shown to the couple). */
  failureDetail: text("failure_detail"),
  // --- growth loop (growth-loop.md 4.2): denormalized read path for "gallery viewed" ---
  firstViewedAt: timestamp("first_viewed_at"),
  viewCount: integer("view_count").notNull().default(0),
  ctaClicks: integer("cta_clicks").notNull().default(0),
  // --- funnel (funnel-ux.md, fixed by shared-contract.md D17) ---
  kind: text("kind").notNull().default("couple"),
  createdVia: text("created_via").notNull().default("couple_link"),
  /** "YYYY-MM" the couple told us; passed to the venue's date CTA. */
  weddingMonth: text("wedding_month"),
  /** Both partners agreed to the AI preview and photo handling. */
  consentAt: timestamp("consent_at"),
  /** Venue marked this couple as booked (one click in the dashboard). */
  bookedAt: timestamp("booked_at"),
  /** "operator:<email>" or "owner:<clerkUserId>" who marked it. */
  bookedBy: text("booked_by"),
  /** Couple source photos deleted after COUPLE_PHOTO_RETENTION_DAYS. */
  sourcePhotosDeletedAt: timestamp("source_photos_deleted_at"),
  /**
   * Set when the gallery turned ready but must wait for the owner
   * ("review_before_send" or "unjudged_frames"): the share link shows a
   * waiting view and serves no assets until the owner sends it, which clears it.
   */
  deliveryHoldReason: text("delivery_hold_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}).enableRLS();

export const coupleMediaTable = pgTable("couple_media", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => coupleSessionsTable.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}).enableRLS();

export const generatedAssetsTable = pgTable(
  "generated_assets",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => coupleSessionsTable.id, { onDelete: "cascade" }),
    objectKey: text("object_key").notNull(),
    assetType: text("asset_type").notNull().default("image"),
    displayOrder: integer("display_order").notNull().default(0),
    generationModel: text("generation_model"),
    generationAttempts: integer("generation_attempts"),
    venueReferenceIndexes: jsonb("venue_reference_indexes").$type<number[] | null>(),
    qualityReport: jsonb("quality_report").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    objectKeyUnique: uniqueIndex("generated_assets_object_key_unique").on(table.objectKey),
    sessionSlotUnique: uniqueIndex("generated_assets_session_slot_unique").on(
      table.sessionId,
      table.assetType,
      table.displayOrder,
    ),
  }),
).enableRLS();

/** Append-only gallery funnel log; aggregated per couple in the dashboard and per venue in stats/proof. */
export const galleryEventsTable = pgTable(
  "gallery_events",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => coupleSessionsTable.id, { onDelete: "cascade" }),
    venueId: integer("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    source: text("source"),
    /** Salted hash of the viewer IP, used only to dedupe repeat views. */
    ipHash: text("ip_hash"),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index("gallery_events_session_idx").on(table.sessionId, table.createdAt),
    venueTypeIdx: index("gallery_events_venue_type_idx").on(table.venueId, table.eventType, table.createdAt),
  }),
).enableRLS();

/** One row per image render attempt: model, fallback, tokens, latency, judge verdict (measured COGS). */
export const renderAttemptsTable = pgTable(
  "render_attempts",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => coupleSessionsTable.id, { onDelete: "cascade" }),
    sceneId: text("scene_id").notNull(),
    attempt: integer("attempt").notNull(),
    model: text("model").notNull(),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    size: text("size"),
    quality: text("quality"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    judgeReport: jsonb("judge_report").$type<Record<string, unknown> | null>(),
    /** accepted | rejected | error | blocked | timeout */
    outcome: text("outcome").notNull(),
    errorClass: text("error_class"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index("render_attempts_session_idx").on(table.sessionId, table.createdAt),
  }),
).enableRLS();

export type CoupleSession = typeof coupleSessionsTable.$inferSelect;
export type InsertCoupleSession = typeof coupleSessionsTable.$inferInsert;
export type CoupleMedia = typeof coupleMediaTable.$inferSelect;
export type GeneratedAsset = typeof generatedAssetsTable.$inferSelect;
export type GalleryEvent = typeof galleryEventsTable.$inferSelect;
export type InsertGalleryEvent = typeof galleryEventsTable.$inferInsert;
export type RenderAttempt = typeof renderAttemptsTable.$inferSelect;
export type InsertRenderAttempt = typeof renderAttemptsTable.$inferInsert;
