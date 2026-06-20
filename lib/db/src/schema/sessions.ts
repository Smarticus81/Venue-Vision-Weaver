import { pgTable, text, serial, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { venuesTable } from "./venues";

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const coupleMediaTable = pgTable("couple_media", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => coupleSessionsTable.id, { onDelete: "cascade" }),
  objectKey: text("object_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
);

export const insertSessionSchema = createInsertSchema(coupleSessionsTable).omit({ id: true, createdAt: true });
export const selectSessionSchema = createSelectSchema(coupleSessionsTable);

export type CoupleSession = typeof coupleSessionsTable.$inferSelect;
export type InsertCoupleSession = typeof coupleSessionsTable.$inferInsert;
export type CoupleMedia = typeof coupleMediaTable.$inferSelect;
export type GeneratedAsset = typeof generatedAssetsTable.$inferSelect;
