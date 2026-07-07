import type { Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  organizationsTable,
  venuesTable,
  creditTransactionsTable,
  type Organization,
} from "@workspace/db";
import { isCorsOriginAllowed } from "./httpSecurity.js";
import { logger } from "./logger.js";
import { clerkPublishableKey } from "./clerkEnv.js";

export { clerkPublishableKey };

export function clerkEnabled(): boolean {
  // clerkMiddleware() needs the secret AND publishable key. A partial config
  // must degrade to 503s on owner/org routes, not throw on every request
  // passing through the middleware.
  return Boolean(process.env.CLERK_SECRET_KEY?.trim() && clerkPublishableKey());
}

/* ————— Mutation-origin checks (unchanged policy, moved from ownerAuth) ————— */

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

/* ————— Organization resolution ————— */

async function fetchClerkOrgName(clerkOrgId: string): Promise<string> {
  try {
    const org = await clerkClient.organizations.getOrganization({ organizationId: clerkOrgId });
    return org.name || "My organization";
  } catch (err) {
    logger.warn({ err, clerkOrgId }, "Could not fetch Clerk organization name");
    return "My organization";
  }
}

export async function fetchClerkUserEmail(clerkUserId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    const email =
      user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
    return email ? email.trim().toLowerCase() : null;
  } catch (err) {
    logger.warn({ err, clerkUserId }, "Could not fetch Clerk user email");
    return null;
  }
}

export async function ensureOrganizationByClerkId(
  clerkOrgId: string,
  name?: string | null,
): Promise<Organization> {
  const [existing] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.clerkOrgId, clerkOrgId));
  if (existing) return existing;

  const orgName = name?.trim() || (await fetchClerkOrgName(clerkOrgId));
  const [created] = await db
    .insert(organizationsTable)
    .values({ clerkOrgId, name: orgName })
    .onConflictDoNothing({ target: organizationsTable.clerkOrgId })
    .returning();
  if (created) {
    logger.info({ clerkOrgId, orgName }, "Provisioned organization with trial credits");
    return created;
  }

  const [row] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.clerkOrgId, clerkOrgId));
  if (!row) throw new Error("Failed to provision organization");
  return row;
}

/**
 * Adopt pre-Clerk venues into the caller's organization: any venue with no
 * organization whose owner email matches the signed-in user moves under the
 * org, and its remaining venue-level credits are folded into the org balance.
 */
async function adoptLegacyVenues(org: Organization, userEmail: string): Promise<void> {
  const adopted = await db.transaction(async (tx) => {
    const rows = await tx
      .update(venuesTable)
      .set({ organizationId: org.id })
      .where(
        and(
          isNull(venuesTable.organizationId),
          sql`lower(${venuesTable.ownerEmail}) = ${userEmail}`,
        ),
      )
      .returning({ id: venuesTable.id, creditsBalance: venuesTable.creditsBalance });

    if (!rows.length) return rows;

    const carried = rows.reduce((sum, row) => sum + Math.max(0, row.creditsBalance), 0);
    if (carried > 0) {
      await tx
        .update(venuesTable)
        .set({ creditsBalance: 0 })
        .where(eq(venuesTable.organizationId, org.id));
      await tx
        .update(organizationsTable)
        .set({ creditsBalance: sql`${organizationsTable.creditsBalance} + ${carried}` })
        .where(eq(organizationsTable.id, org.id));
      await tx.insert(creditTransactionsTable).values({
        organizationId: org.id,
        delta: carried,
        reason: "admin_adjust",
      });
    }
    return rows;
  });

  if (adopted.length) {
    logger.info(
      { orgId: org.id, venueIds: adopted.map((v) => v.id) },
      "Adopted legacy venues into organization",
    );
  }
}

type OrgContext = {
  org: Organization;
  clerkUserId: string;
  clerkOrgId: string;
  orgRole: string | null;
};

/**
 * Require a signed-in Clerk user with an active organization. Provisions the
 * local organization row (with trial credits) on first touch and adopts any
 * legacy venues owned by the user's email.
 */
export async function requireOrg(req: Request, res: Response): Promise<OrgContext | null> {
  if (!clerkEnabled()) {
    res.status(503).json({
      error:
        "Authentication is not configured on this server (CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY are both required).",
    });
    return null;
  }

  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Sign in required" });
    return null;
  }
  if (!auth.orgId) {
    res.status(403).json({
      error: "No active organization. Create or select your organization to continue.",
      code: "no_active_organization",
    });
    return null;
  }

  const org = await ensureOrganizationByClerkId(auth.orgId);

  // One cheap adoption pass per request only when the org has no venues yet.
  const [anyVenue] = await db
    .select({ id: venuesTable.id })
    .from(venuesTable)
    .where(eq(venuesTable.organizationId, org.id))
    .limit(1);
  if (!anyVenue) {
    const email = await fetchClerkUserEmail(auth.userId);
    if (email) await adoptLegacyVenues(org, email);
  }

  return {
    org,
    clerkUserId: auth.userId,
    clerkOrgId: auth.orgId,
    orgRole: auth.orgRole ?? null,
  };
}

/**
 * Local DB id of the caller's active organization, or null when the request
 * is unauthenticated / has no active org. Never writes an HTTP response.
 */
export async function getCallerOrgDbId(req: Request): Promise<number | null> {
  if (!clerkEnabled()) return null;
  const auth = getAuth(req);
  if (!auth.userId || !auth.orgId) return null;
  const org = await ensureOrganizationByClerkId(auth.orgId);
  return org.id;
}

/**
 * Org-scoped replacement for the old requireOwnerVenue: resolves a venue by
 * slug and verifies it belongs to the caller's active organization. Applies
 * the same mutation-origin policy as before.
 */
export async function requireOrgVenue(req: Request, res: Response, slug: string) {
  if (!requireOwnerMutationOrigin(req, res)) return null;

  const ctx = await requireOrg(req, res);
  if (!ctx) return null;

  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(and(eq(venuesTable.slug, slug), eq(venuesTable.organizationId, ctx.org.id)));

  if (!venue) {
    res.status(404).json({ error: "Venue not found" });
    return null;
  }

  return venue;
}
