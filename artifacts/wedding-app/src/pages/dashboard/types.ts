import type {
  OrganizationResponseOrganization,
  PublicConfig,
  SessionSummary,
  VenueMediaItem,
  VenueResponse,
} from "@workspace/api-client-react";
import type { Coverage } from "./activation";

export type BillingProductId = "starter" | "growth" | "credit_pack";

export interface BillingProduct {
  id: BillingProductId;
  title: string;
  description: string;
  cta: string;
  recommended?: boolean;
}

export interface CoverageOption {
  value: Coverage;
  label: string;
  hint: string;
}

export type DashboardTab = "galleries" | "new" | "photos" | "settings" | "billing";

/** What the shell knows about billing and hands to the panels. */
export interface BillingActions {
  startCheckout: (product: BillingProductId) => void;
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
  goTo: (tab: DashboardTab) => void;
}
