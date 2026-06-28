import crypto from "crypto";
import type { Request, Response } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  db,
  ownerCredentialsTable,
  ownerLoginTokensTable,
  ownerSessionsTable,
  venuesTable,
} from "@workspace/db";
import { getAppBaseUrl } from "./appUrl.js";
import { isCorsOriginAllowed } from "./httpSecurity.js";

export const OWNER_SESSION_COOKIE = "glimpse_owner_session";
const LOGIN_TOKEN_MINUTES = 15;
const SESSION_DAYS = 30;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function createOwnerPasswordHash(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS).toString("base64url");
  return `scrypt$${salt}$${key}`;
}

function verifyPasswordHash(password: string, encodedHash: string): boolean {
  const [algorithm, salt, storedKey] = encodedHash.split("$");
  if (algorithm !== "scrypt" || !salt || !storedKey) return false;

  const expected = Buffer.from(storedKey, "base64url");
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
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

export function isStrongOwnerPassword(password: string): boolean {
  return password.length >= 8;
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

function isLoopbackHost(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "::1") return true;
  const host = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]"))
    : trimmed.includes(":")
      ? trimmed.split(":")[0]
      : trimmed;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function isLoopbackOrigin(value: string | null): boolean {
  if (!value) return false;
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

export function isOwnerMutationOriginAllowed(req: Pick<Request, "method" | "headers">): boolean {
  if (isSafeMethod(req.method)) return true;
  if (process.env.NODE_ENV !== "production") return true;

  const requestHost =
    typeof req.headers["x-forwarded-host"] === "string"
      ? req.headers["x-forwarded-host"]
      : typeof req.headers.host === "string"
        ? req.headers.host
        : undefined;

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const originValue = originFromUrl(origin);
  if (isLoopbackHost(requestHost) && isLoopbackOrigin(originValue)) return true;
  if (origin) return isCorsOriginAllowed(origin);

  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
  const refererOrigin = originFromUrl(referer);
  if (isLoopbackHost(requestHost) && isLoopbackOrigin(refererOrigin)) return true;
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

export async function upsertOwnerPassword(ownerEmail: string, password: string): Promise<void> {
  const email = normalizeEmail(ownerEmail);
  const passwordHash = createOwnerPasswordHash(password);
  await db
    .insert(ownerCredentialsTable)
    .values({
      ownerEmail: email,
      passwordHash,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: ownerCredentialsTable.ownerEmail,
      set: {
        passwordHash,
        updatedAt: new Date(),
      },
    });
}

export async function createOwnerSession(ownerEmail: string): Promise<string> {
  const rawSession = crypto.randomBytes(32).toString("base64url");
  await db.insert(ownerSessionsTable).values({
    sessionHash: sha256(rawSession),
    ownerEmail: normalizeEmail(ownerEmail),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  return rawSession;
}

export async function loginOwnerWithPassword(
  ownerEmail: string,
  password: string,
): Promise<string | null> {
  const email = normalizeEmail(ownerEmail);
  const [credential] = await db
    .select({ passwordHash: ownerCredentialsTable.passwordHash })
    .from(ownerCredentialsTable)
    .where(eq(ownerCredentialsTable.ownerEmail, email))
    .limit(1);
  if (!credential || !verifyPasswordHash(password, credential.passwordHash)) {
    return null;
  }
  return createOwnerSession(email);
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

  return createOwnerSession(row.ownerEmail);
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
