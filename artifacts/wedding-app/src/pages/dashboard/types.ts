import type {
  OrganizationResponseOrganization,
  PublicConfig,
  SessionSummary,
  VenueMediaItem,
  VenueResponse,
} from "@workspace/api-client-react";
import type { SpendCheck, VenueReadiness } from "./activation";

export type BillingProductId = "starter" | "growth" | "credit_pack";

export type DashboardTab = "galleries" | "new" | "photos" | "settings" | "billing";

/** What the shell knows about billing and hands to the panels. */
export interface BillingActions {
  /** Starts Stripe Checkout; a 409 subscription_exists answer opens the portal instead. */
  startCheckout: (product: BillingProductId, source: string) => void;
  openPortal: () => void;
  checkoutPending: BillingProductId | null;
  portalPending: boolean;
  /** Only org admins may start checkout or open the portal. */
  isAdmin: boolean;
  billingConfigured: boolean;
}

/**
 * GET /org already answers subscriptionStatus and cancelAtPeriodEnd (WS-A);
 * the OpenAPI schema does not list them yet, so they are read defensively.
 */
export interface OrgExtras {
  subscriptionStatus: "active" | "past_due" | "canceled" | "paused" | null;
  cancelAtPeriodEnd: boolean;
}

export function readOrgExtras(org: OrganizationResponseOrganization | null | undefined): OrgExtras {
  const raw = org as (OrganizationResponseOrganization & { subscriptionStatus?: unknown; cancelAtPeriodEnd?: unknown }) | null | undefined;
  const status = raw?.subscriptionStatus;
  return {
    subscriptionStatus:
      status === "active" || status === "past_due" || status === "canceled" || status === "paused" ? status : null,
    cancelAtPeriodEnd: raw?.cancelAtPeriodEnd === true,
  };
}

export interface DashboardContext {
  organization: OrganizationResponseOrganization;
  venue: VenueResponse;
  slug: string;
  sessions: SessionSummary[];
  media: VenueMediaItem[];
  publicConfig: PublicConfig;
  readiness: VenueReadiness;
  spend: SpendCheck;
  billing: BillingActions;
  /** The link couples open: {origin}/preview/{slug}. */
  coupleUrl: string;
  goTo: (tab: DashboardTab) => void;
  refreshMedia: () => Promise<unknown>;
  refreshDashboard: () => Promise<unknown>;
  refreshOrg: () => Promise<unknown>;
}
