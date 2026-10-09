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
