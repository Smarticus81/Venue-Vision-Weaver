import crypto from "crypto";
import type { Request, Response } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, ownerLoginTokensTable, ownerSessionsTable, venuesTable } from "@workspace/db";
import { getAppBaseUrl } from "./appUrl.js";
import { isCorsOriginAllowed } from "./httpSecurity.js";

export const OWNER_SESSION_COOKIE = "glimpse_owner_session";
const LOGIN_TOKEN_MINUTES = 15;
const SESSION_DAYS = 30;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function ownerCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeMs,
  };
}

function normalizeNextPath(nextPath: string | null | undefined): string | null {
  if (!nextPath) return null;
  if (!nextPath.startsWith("/") || nextPath.startsWith("//")) return null;
  return nextPath;
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function originFromUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function isOwnerMutationOriginAllowed(req: Pick<Request, "method" | "headers">): boolean {
  if (isSafeMethod(req.method)) return true;
  if (process.env.NODE_ENV !== "production") return true;

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (origin) return isCorsOriginAllowed(origin);

  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
  const refererOrigin = originFromUrl(referer);
  if (refererOrigin) return isCorsOriginAllowed(refererOrigin);

  return false;
}

export function requireOwnerMutationOrigin(req: Request, res: Response): boolean {
  if (isOwnerMutationOriginAllowed(req)) return true;
  res.status(403).json({ error: "Owner request origin is not allowed" });
  return false;
}

export async function createOwnerLoginLink(
  ownerEmail: string,
  nextPath?: string | null,
): Promise<string> {
  const email = normalizeEmail(ownerEmail);
  const raw = crypto.randomBytes(32).toString("base64url");
  await db.insert(ownerLoginTokensTable).values({
    tokenHash: sha256(raw),
    ownerEmail: email,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60 * 1000),
  });
  const url = new URL("/owner/login", getAppBaseUrl());
  url.searchParams.set("token", raw);
  const safeNext = normalizeNextPath(nextPath);
  if (safeNext) url.searchParams.set("next", safeNext);
  return url.toString();
}

export async function exchangeOwnerLoginToken(token: string): Promise<string | null> {
  const hash = sha256(token);
  const claimedAt = new Date();
  const [row] = await db
    .update(ownerLoginTokensTable)
    .set({ usedAt: claimedAt })
    .where(
      and(
        eq(ownerLoginTokensTable.tokenHash, hash),
        isNull(ownerLoginTokensTable.usedAt),
        gt(ownerLoginTokensTable.expiresAt, claimedAt),
      ),
    )
    .returning({ ownerEmail: ownerLoginTokensTable.ownerEmail });

  if (!row) return null;

  const rawSession = crypto.randomBytes(32).toString("base64url");
  await db.insert(ownerSessionsTable).values({
    sessionHash: sha256(rawSession),
    ownerEmail: normalizeEmail(row.ownerEmail),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return rawSession;
}

export async function getOwnerEmailFromRequest(req: Request): Promise<string | null> {
  const token = typeof req.cookies?.[OWNER_SESSION_COOKIE] === "string"
    ? req.cookies[OWNER_SESSION_COOKIE]
    : "";
  if (!token) return null;
  const [session] = await db
    .select({ ownerEmail: ownerSessionsTable.ownerEmail })
    .from(ownerSessionsTable)
    .where(
      and(
        eq(ownerSessionsTable.sessionHash, sha256(token)),
        eq(ownerSessionsTable.revoked, false),
        gt(ownerSessionsTable.expiresAt, new Date()),
      ),
    );
  return session?.ownerEmail ?? null;
}

export async function revokeOwnerSession(req: Request): Promise<void> {
  const token = typeof req.cookies?.[OWNER_SESSION_COOKIE] === "string"
    ? req.cookies[OWNER_SESSION_COOKIE]
    : "";
  if (!token) return;
  await db
    .update(ownerSessionsTable)
    .set({ revoked: true })
    .where(eq(ownerSessionsTable.sessionHash, sha256(token)));
}

export async function requireOwnerVenue(req: Request, res: Response, slug: string) {
  if (!requireOwnerMutationOrigin(req, res)) return null;

  const ownerEmail = await getOwnerEmailFromRequest(req);
  if (!ownerEmail) {
    res.status(401).json({ error: "Owner login required" });
    return null;
  }

  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(
      and(
        eq(venuesTable.slug, slug),
        sql`lower(${venuesTable.ownerEmail}) = ${ownerEmail}`,
      ),
    );

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return null;
  }

  return venue;
}
