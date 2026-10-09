import type { Request, Response } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  organizationsTable,
  venuesTable,
  creditTransactionsTable,
  billingEventsTable,
  TRIAL_CREDITS,
  type Organization,
} from "@workspace/db";
import { isCorsOriginAllowed } from "./httpSecurity.js";
import { logger } from "./logger.js";
import { clerkPublishableKey } from "./clerkEnv.js";
import { readTrialConfig } from "./publicConfig.js";
import { recordFunnelEvent, type FunnelEventInput } from "./funnelEvents.js";

export { clerkPublishableKey };

export function clerkEnabled(): boolean {
  // clerkMiddleware() needs the secret AND publishable key. A partial config
  // must degrade to 503s on owner/org routes, not throw on every request
  // passing through the middleware.
  return Boolean(process.env.CLERK_SECRET_KEY?.trim() && clerkPublishableKey());
}

/* ————— Mutation-origin checks ————— */

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

/** The origin's host (with port) equals the Host header the request arrived on. */
function originMatchesRequestHost(originValue: string, requestHost: string | undefined): boolean {
  if (!requestHost?.trim()) return false;
  try {
    return new URL(originValue).host.toLowerCase() === requestHost.trim().toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Production browsers must send an Origin (or Referer) that is either a
 * configured CORS origin or the very host the request arrived on, so the apex
 * and www variants of the public host both work without listing each. There is
 * no loopback carve-out in production: X-Forwarded-Host is attacker-controlled
 * unless a proxy strips it, and non-production skips the check entirely.
 */
export function isOwnerMutationOriginAllowed(req: Pick<Request, "method" | "headers">): boolean {
  if (isSafeMethod(req.method)) return true;
  if (process.env.NODE_ENV !== "production") return true;

  const requestHost = typeof req.headers.host === "string" ? req.headers.host : undefined;

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const originValue = originFromUrl(origin);
  if (origin) {
    if (isCorsOriginAllowed(origin)) return true;
    if (originValue && originMatchesRequestHost(originValue, requestHost)) return true;
    logger.warn({ origin, requestHost, method: req.method }, "Owner mutation rejected: untrusted Origin");
    return false;
  }

  const referer = typeof req.headers.referer === "string" ? req.headers.referer : undefined;
  const refererOrigin = originFromUrl(referer);
  if (refererOrigin) {
    if (isCorsOriginAllowed(refererOrigin)) return true;
    if (originMatchesRequestHost(refererOrigin, requestHost)) return true;
    logger.warn({ refererOrigin, requestHost, method: req.method }, "Owner mutation rejected: untrusted Referer");
    return false;
  }

  logger.warn({ requestHost, method: req.method }, "Owner mutation rejected: no Origin or Referer");
  return false;
}

export function requireOwnerMutationOrigin(req: Request, res: Response): boolean {
  if (isOwnerMutationOriginAllowed(req)) return true;
  res.status(403).json({ error: "Owner request origin is not allowed" });
  return false;
}

/* ————— Clerk lookups ————— */

async function fetchClerkOrgName(clerkOrgId: string): Promise<string> {
  try {
    const org = await clerkClient.organizations.getOrganization({ organizationId: clerkOrgId });
    return org.name || "My organization";
  } catch (err) {
    logger.warn({ err, clerkOrgId }, "Could not fetch Clerk organization name");
    return "My organization";
  }
}

type ClerkEmailLike = {
  emailAddress: string;
  verification?: { status?: string | null } | null;
};

/** Pure: the primary address when verified, else the first verified address, else null. */
export function pickVerifiedEmail(
  emails: readonly ClerkEmailLike[],
  primaryEmailAddressId: string | null | undefined,
  idOf: (email: ClerkEmailLike) => string | null = () => null,
): string | null {
  const verified = emails.filter((email) => email.verification?.status === "verified");
  const primary = verified.find((email) => primaryEmailAddressId != null && idOf(email) === primaryEmailAddressId);
  const chosen = primary ?? verified[0];
  const value = chosen?.emailAddress?.trim().toLowerCase();
  return value ? value : null;
}

/** Verified Clerk email for a user (billing email, legacy venue adoption, lifecycle contact). */
export async function fetchClerkUserEmail(clerkUserId: string): Promise<string | null> {
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    return pickVerifiedEmail(
      user.emailAddresses,
      user.primaryEmailAddressId,
      (email) => (email as { id?: string }).id ?? null,
    );
  } catch (err) {
    logger.warn({ err, clerkUserId }, "Could not fetch Clerk user email");
    return null;
  }
}

/* ————— Organization provisioning (trial clock + once-per-user trial grant) ————— */

export interface ProvisionedOrg {
  id: number;
  clerkOrgId: string;
  name: string;
  plan: string;
  creditsBalance: number;
  trialGrantedByClerkUserId: string | null;
}

/** Storage seam for provisioning so the trial rules are testable without a database. */
export interface OrgProvisioningStore {
  findByClerkOrgId(clerkOrgId: string): Promise<ProvisionedOrg | null>;
  /** Insert if absent; returns the row that exists afterwards (insert or concurrent winner). */
  insertIfAbsent(values: { clerkOrgId: string; name: string; trialEndsAt: Date }): Promise<{ org: ProvisionedOrg; created: boolean }>;
  /**
   * Atomically mark the org as the user's one trial and add the credits, only when
   * the org is on trial, has no grantee, has never had a trial_grant row and holds no
   * credits, and the user has not received a trial on any other organization.
   */
  claimTrialGrant(orgId: number, clerkUserId: string, credits: number): Promise<boolean>;
  insertTrialLedger(orgId: number, credits: number): Promise<void>;
  recordBillingTrialStarted(orgId: number, credits: number): Promise<void>;
  recordFunnelEvent(input: FunnelEventInput): Promise<void>;
}

export interface ProvisionInput {
  clerkOrgId: string;
  name?: string | null;
  /** The Clerk user acting (sign-in) or creating (organization.created webhook); null when unknown. */
  clerkUserId?: string | null;
  trialDays?: number;
  trialCredits?: number;
  now?: Date;
  /** Resolves the org name from Clerk when the caller has none. */
  fetchName?: (clerkOrgId: string) => Promise<string>;
}

export interface ProvisionResult {
  org: ProvisionedOrg;
  created: boolean;
  trialGranted: boolean;
}

/**
 * Ensure the organization row exists and ledger its trial exactly once per
 * Clerk user (E5): new rows start at 0 credits with trial_ends_at set; the
 * grant is a separate atomic claim so the Clerk webhook and the first
 * signed-in request can race in any order and the credits still land once.
 */
export async function provisionOrganization(store: OrgProvisioningStore, input: ProvisionInput): Promise<ProvisionResult> {
  const now = input.now ?? new Date();
  const trialDays = input.trialDays ?? readTrialConfig().days;
  const trialCredits = input.trialCredits ?? TRIAL_CREDITS;

  let org = await store.findByClerkOrgId(input.clerkOrgId);
  let created = false;
  if (!org) {
    const name = input.name?.trim() || (input.fetchName ? await input.fetchName(input.clerkOrgId) : "My organization");
    const inserted = await store.insertIfAbsent({
      clerkOrgId: input.clerkOrgId,
      name,
      trialEndsAt: new Date(now.getTime() + trialDays * 86_400_000),
    });
    org = inserted.org;
    created = inserted.created;
    if (created) {
      await store.recordFunnelEvent({ organizationId: org.id, event: "org_created", source: "server" });
    }
  }

  let trialGranted = false;
  if (input.clerkUserId && org.plan === "trial" && org.trialGrantedByClerkUserId == null) {
    trialGranted = await store.claimTrialGrant(org.id, input.clerkUserId, trialCredits);
    if (trialGranted) {
      await store.insertTrialLedger(org.id, trialCredits);
      await store.recordBillingTrialStarted(org.id, trialCredits);
      await store.recordFunnelEvent({
        organizationId: org.id,
        event: "trial_started",
        properties: { credits: trialCredits, days: trialDays },
        source: "server",
      });
      org = {
        ...org,
        creditsBalance: org.creditsBalance + trialCredits,
        trialGrantedByClerkUserId: input.clerkUserId,
      };
    }
  }

  return { org, created, trialGranted };
}

function toProvisioned(row: Organization): ProvisionedOrg {
  return {
    id: row.id,
    clerkOrgId: row.clerkOrgId,
    name: row.name,
    plan: row.plan,
    creditsBalance: row.creditsBalance,
    trialGrantedByClerkUserId: row.trialGrantedByClerkUserId,
  };
}

/** Postgres unique violation (23505) on the named constraint/index, unwrapping driver causes. */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let current: unknown = err;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && candidate.constraint === constraint) return true;
    current = candidate.cause;
  }
  return false;
}

export function createDbProvisioningStore(): OrgProvisioningStore {
  return {
    async findByClerkOrgId(clerkOrgId) {
      const [row] = await db.select().from(organizationsTable).where(eq(organizationsTable.clerkOrgId, clerkOrgId));
      return row ? toProvisioned(row) : null;
    },
    async insertIfAbsent(values) {
      const [created] = await db
        .insert(organizationsTable)
        // Explicit 0: the schema default (TRIAL_CREDITS) predates the ledgered
        // trial grant; credits now arrive only through claimTrialGrant.
        .values({ clerkOrgId: values.clerkOrgId, name: values.name, creditsBalance: 0, trialEndsAt: values.trialEndsAt })
        .onConflictDoNothing({ target: organizationsTable.clerkOrgId })
        .returning();
      if (created) return { org: toProvisioned(created), created: true };
      const [row] = await db.select().from(organizationsTable).where(eq(organizationsTable.clerkOrgId, values.clerkOrgId));
      if (!row) throw new Error("Failed to provision organization");
      return { org: toProvisioned(row), created: false };
    },
    async claimTrialGrant(orgId, clerkUserId, credits) {
      let claimed: Array<{ id: number }>;
      try {
        claimed = await db
          .update(organizationsTable)
          .set({
            trialGrantedByClerkUserId: clerkUserId,
            creditsBalance: sql`${organizationsTable.creditsBalance} + ${credits}`,
          })
          .where(
            and(
              eq(organizationsTable.id, orgId),
              eq(organizationsTable.plan, "trial"),
              isNull(organizationsTable.trialGrantedByClerkUserId),
              eq(organizationsTable.creditsBalance, 0),
              sql`not exists (select 1 from ${creditTransactionsTable} where ${creditTransactionsTable.organizationId} = ${orgId} and ${creditTransactionsTable.reason} = 'trial_grant')`,
              sql`not exists (select 1 from ${organizationsTable} o2 where o2.trial_granted_by_clerk_user_id = ${clerkUserId})`,
            ),
          )
          .returning({ id: organizationsTable.id });
      } catch (err) {
        // organizations_trial_grantee_unique: a concurrent claim for the same
        // Clerk user on another organization won. This one starts without
        // the trial (the user already has it), never as a 500.
        if (isUniqueViolation(err, "organizations_trial_grantee_unique")) return false;
        throw err;
      }
      return claimed.length > 0;
    },
    async insertTrialLedger(orgId, credits) {
      await db.insert(creditTransactionsTable).values({ organizationId: orgId, delta: credits, reason: "trial_grant" });
    },
    async recordBillingTrialStarted(orgId, credits) {
      try {
        await db.insert(billingEventsTable).values({
          organizationId: orgId,
          kind: "trial_started",
          plan: "trial",
          faceValueCredits: credits,
        });
      } catch (err) {
        logger.warn({ err, orgId }, "trial_started billing event not recorded");
      }
    },
    recordFunnelEvent,
  };
}

/**
 * Local organization row for a Clerk organization, provisioned on first touch
 * with the trial clock. Pass the acting user so the one-time trial grant can
 * be ledgered; without a user the row is created unfunded and the grant
 * happens on the member's first signed-in request.
 */
export async function ensureOrganizationByClerkId(
  clerkOrgId: string,
  name?: string | null,
  options: { clerkUserId?: string | null } = {},
): Promise<Organization> {
  const result = await provisionOrganization(createDbProvisioningStore(), {
    clerkOrgId,
    name,
    clerkUserId: options.clerkUserId ?? null,
    fetchName: fetchClerkOrgName,
  });
  if (result.created) {
    logger.info({ clerkOrgId, orgName: result.org.name, trialGranted: result.trialGranted }, "Provisioned organization");
  } else if (result.trialGranted) {
    logger.info({ clerkOrgId, orgId: result.org.id }, "Ledgered trial grant for existing organization");
  }

  const [row] = await db.select().from(organizationsTable).where(eq(organizationsTable.clerkOrgId, clerkOrgId));
  if (!row) throw new Error("Failed to provision organization");
  return row;
}

/* ————— Legacy venue adoption + contact email (once per process per org) ————— */

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

// Per-process memo so requireOrg does not call the Clerk Users API on every
// request while an org has no venues yet (the whole create-venue step).
const adoptionAttempted = new Set<string>();
const contactEmailAttempted = new Set<number>();
const trialClaimAttempted = new Set<string>();

/**
 * The acting user is offered as trial claimant once per (org, user) per
 * process: the claim is a single conditional UPDATE, but there is no reason
 * to repeat it on every request once it has run.
 */
function trialClaimantOnce(clerkOrgId: string, clerkUserId: string): string | null {
  const key = `${clerkOrgId}:${clerkUserId}`;
  if (trialClaimAttempted.has(key)) return null;
  trialClaimAttempted.add(key);
  return clerkUserId;
}

/**
 * Run fn with the acting user offered as trial claimant (once per org+user
 * per process). The memo is only kept when fn completes: a claim that threw
 * (a DB timeout, a reset connection) is offered again on the next request,
 * so a transient error never leaves the org without its trial.
 */
export async function withTrialClaimantOnce<T>(
  clerkOrgId: string,
  clerkUserId: string,
  fn: (claimant: string | null) => Promise<T>,
): Promise<T> {
  const claimant = trialClaimantOnce(clerkOrgId, clerkUserId);
  try {
    return await fn(claimant);
  } catch (err) {
    if (claimant) trialClaimAttempted.delete(`${clerkOrgId}:${clerkUserId}`);
    throw err;
  }
}

/** Test hook: forget the per-process memos. */
export function resetOrgAuthMemos(): void {
  adoptionAttempted.clear();
  contactEmailAttempted.clear();
  trialClaimAttempted.clear();
}

async function runFirstTouchPasses(org: Organization, clerkUserId: string): Promise<Organization> {
  let current = org;
  const needsEmail =
    (!contactEmailAttempted.has(org.id) && org.contactEmail == null) ||
    !adoptionAttempted.has(`${org.id}:${clerkUserId}`);
  if (!needsEmail) return current;

  const email = await fetchClerkUserEmail(clerkUserId);

  if (!adoptionAttempted.has(`${org.id}:${clerkUserId}`)) {
    adoptionAttempted.add(`${org.id}:${clerkUserId}`);
    const [anyVenue] = await db
      .select({ id: venuesTable.id })
      .from(venuesTable)
      .where(eq(venuesTable.organizationId, org.id))
      .limit(1);
    if (!anyVenue && email) {
      try {
        await adoptLegacyVenues(org, email);
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "Legacy venue adoption failed");
      }
    }
  }

  if (!contactEmailAttempted.has(org.id) && org.contactEmail == null) {
    contactEmailAttempted.add(org.id);
    if (email) {
      try {
        await db
          .update(organizationsTable)
          .set({ contactEmail: email })
          .where(and(eq(organizationsTable.id, org.id), isNull(organizationsTable.contactEmail)));
      } catch (err) {
        logger.warn({ err, orgId: org.id }, "Could not record organization contact email");
      }
    }
  }

  const [fresh] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, org.id));
  if (fresh) current = fresh;
  return current;
}

export type OrgContext = {
  org: Organization;
  clerkUserId: string;
  clerkOrgId: string;
  orgRole: string | null;
};

/**
 * True when the caller is an admin of their active Clerk organization. Thin
 * helper so route workstreams can gate destructive routes (billing changes,
 * org preferences) without re-reading the Clerk role string.
 */
export function requireOrgAdmin(ctx: Pick<OrgContext, "orgRole">): boolean {
  return ctx.orgRole === "org:admin";
}

/**
 * Require a signed-in Clerk user with an active organization. Provisions the
 * local organization row (trial clock + once-per-user trial grant) on first
 * touch, records the contact email, and adopts any legacy venues owned by the
 * user's verified email.
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

  const clerkOrgId = auth.orgId;
  let org = await withTrialClaimantOnce(clerkOrgId, auth.userId, (claimant) =>
    ensureOrganizationByClerkId(clerkOrgId, undefined, { clerkUserId: claimant }),
  );

  org = await runFirstTouchPasses(org, auth.userId);

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
  const clerkOrgId = auth.orgId;
  const org = await withTrialClaimantOnce(clerkOrgId, auth.userId, (claimant) =>
    ensureOrganizationByClerkId(clerkOrgId, undefined, { clerkUserId: claimant }),
  );
  return org.id;
}

/**
 * Org-scoped replacement for the old requireOwnerVenue: resolves a venue by
 * slug and verifies it belongs to the caller's active organization (see
 * requireOrgVenueContext below for the checks).
 */
export async function requireOrgVenue(req: Request, res: Response, slug: string) {
  const resolved = await requireOrgVenueContext(req, res, slug);
  return resolved ? resolved.venue : null;
}

/**
 * The venue check behind requireOrgVenue: applies the mutation-origin policy,
 * requires a Clerk session with an active organization, and resolves the
 * venue only inside that organization. Returns the org context too, for
 * routes that gate on the member's role or record who acted.
 */
export async function requireOrgVenueContext(
  req: Request,
  res: Response,
  slug: string,
): Promise<{ ctx: OrgContext; venue: typeof venuesTable.$inferSelect } | null> {
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

  return { ctx, venue };
}
