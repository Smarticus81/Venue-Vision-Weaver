import type { Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { clerkEnabled } from "../lib/orgAuth.js";
import { logger } from "../lib/logger.js";

/**
 * The control plane is a platform-operator surface, not a venue-owner one.
 * Operators are the Clerk-authenticated users whose emails appear in
 * CONTROL_PLANE_OPERATOR_EMAILS (comma-separated). The gate fails closed: an
 * empty allowlist admits nobody unless CONTROL_PLANE_DEV_OPEN=true is set on a
 * non-production machine, so a deploy that forgot to set NODE_ENV never turns
 * every signed-in venue owner into an operator.
 */
export function operatorEmails(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CONTROL_PLANE_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export type OperatorContext = {
  email: string;
  clerkUserId: string;
};

export type OperatorAccessDecision =
  | { kind: "allowed"; reason: "allowlist" | "dev_open" }
  | { kind: "not_configured" }
  | { kind: "forbidden" };

/** Pure allowlist decision; `email` is already lower-cased. */
export function operatorAccessDecision(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): OperatorAccessDecision {
  const allowed = operatorEmails(env);
  if (allowed.length === 0) {
    const devOpen = (env.CONTROL_PLANE_DEV_OPEN ?? "").trim().toLowerCase() === "true";
    if (devOpen && env.NODE_ENV !== "production") return { kind: "allowed", reason: "dev_open" };
    return { kind: "not_configured" };
  }
  return allowed.includes(email) ? { kind: "allowed", reason: "allowlist" } : { kind: "forbidden" };
}

/* ————— Clerk user -> email, cached ————— */

const EMAIL_CACHE_TTL_MS = 5 * 60_000;
const EMAIL_CACHE_MAX = 2_000;

export type OperatorEmailLookup = { ok: true; email: string | null } | { ok: false; error: string };
type EmailFetcher = (clerkUserId: string) => Promise<string | null>;

const emailCache = new Map<string, { email: string | null; at: number }>();

async function clerkEmailFetcher(clerkUserId: string): Promise<string | null> {
  const user = await clerkClient.users.getUser(clerkUserId);
  const email =
    user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  return email ? email.trim().toLowerCase() : null;
}

/**
 * Every /control request needs the caller's email; the Clerk Users API is
 * slow and rate limited, so lookups are cached briefly. A lookup failure is
 * reported as such (callers answer 503) rather than being mistaken for "this
 * account has no email" (403).
 */
export async function resolveOperatorEmail(
  clerkUserId: string,
  options: { fetcher?: EmailFetcher; now?: number } = {},
): Promise<OperatorEmailLookup> {
  const now = options.now ?? Date.now();
  const cached = emailCache.get(clerkUserId);
  if (cached && now - cached.at < EMAIL_CACHE_TTL_MS) return { ok: true, email: cached.email };

  try {
    const email = await (options.fetcher ?? clerkEmailFetcher)(clerkUserId);
    if (emailCache.size >= EMAIL_CACHE_MAX) {
      const oldest = emailCache.keys().next().value;
      if (oldest !== undefined) emailCache.delete(oldest);
    }
    emailCache.set(clerkUserId, { email, at: now });
    return { ok: true, email };
  } catch (err) {
    logger.warn({ err, clerkUserId }, "Could not resolve Clerk user email for operator check");
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function resetOperatorEmailCache(): void {
  emailCache.clear();
}

/* ————— Request gates ————— */

type OperatorCheck =
  | { ok: true; context: OperatorContext }
  | { ok: false; status: 401 | 403 | 503; error: string };

async function checkOperator(req: Request): Promise<OperatorCheck> {
  if (!clerkEnabled()) {
    return {
      ok: false,
      status: 503,
      error:
        "Authentication is not configured on this server (CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are both required).",
    };
  }

  const auth = getAuth(req);
  if (!auth.userId) return { ok: false, status: 401, error: "Sign in required" };

  const lookup = await resolveOperatorEmail(auth.userId);
  if (!lookup.ok) {
    return {
      ok: false,
      status: 503,
      error: "Could not verify your account right now. Try again shortly.",
    };
  }
  if (!lookup.email) {
    return { ok: false, status: 403, error: "Could not resolve your account email." };
  }

  const decision = operatorAccessDecision(lookup.email);
  if (decision.kind === "not_configured") {
    return {
      ok: false,
      status: 403,
      error:
        "Control-plane operators are not configured. Set CONTROL_PLANE_OPERATOR_EMAILS to a comma-separated allowlist.",
    };
  }
  if (decision.kind === "forbidden") {
    return { ok: false, status: 403, error: "You are not a control-plane operator." };
  }
  return { ok: true, context: { email: lookup.email, clerkUserId: auth.userId } };
}

export async function requireOperator(
  req: Request,
  res: Response,
): Promise<OperatorContext | null> {
  const check = await checkOperator(req);
  if (!check.ok) {
    res.status(check.status).json({ error: check.error });
    return null;
  }
  return check.context;
}

/**
 * Same decision as requireOperator but never writes a response; used by
 * surfaces (readiness detail) that fall back to a public view when the
 * caller is not an operator.
 */
export async function isOperatorRequest(req: Request): Promise<boolean> {
  try {
    const check = await checkOperator(req);
    return check.ok;
  } catch {
    return false;
  }
}
