import { pgTable, text, serial, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { venuesTable } from "./venues";

export const uploadIntentsTable = pgTable(
  "upload_intents",
  {
    id: serial("id").primaryKey(),
    objectKey: text("object_key").notNull(),
    venueId: integer("venue_id").notNull().references(() => venuesTable.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    objectKeyUnique: uniqueIndex("upload_intents_object_key_unique").on(table.objectKey),
  }),
);

export type UploadIntent = typeof uploadIntentsTable.$inferSelect;
