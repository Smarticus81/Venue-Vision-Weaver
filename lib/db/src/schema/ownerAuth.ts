import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";

export const ownerCredentialsTable = pgTable("owner_credentials", {
  id: serial("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ownerLoginTokensTable = pgTable("owner_login_tokens", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  ownerEmail: text("owner_email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ownerSessionsTable = pgTable("owner_sessions", {
  id: serial("id").primaryKey(),
  sessionHash: text("session_hash").notNull().unique(),
  ownerEmail: text("owner_email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OwnerLoginToken = typeof ownerLoginTokensTable.$inferSelect;
export type OwnerSession = typeof ownerSessionsTable.$inferSelect;
export type OwnerCredential = typeof ownerCredentialsTable.$inferSelect;
