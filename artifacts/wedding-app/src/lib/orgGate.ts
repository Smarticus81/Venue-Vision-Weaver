/**
 * Pure decision for OrgGate. Clerk reports useOrganizationList as loaded
 * while userMemberships.data is still [] and its fetch is in flight, so
 * "no memberships" is only believed once that fetch has settled; until then
 * a returning owner on a new browser would be sent to /create-venue.
 */
export interface OrgGateState {
  userLoaded: boolean;
  orgLoaded: boolean;
  listLoaded: boolean;
  isSignedIn: boolean;
  hasOrganization: boolean;
  hasMembership: boolean;
  /** userMemberships.isLoading || userMemberships.isFetching */
  membershipsPending: boolean;
  requireOrganization: boolean;
}

export type OrgGateDecision =
  | "loading"
  | "sign_in"
  | "wait_for_memberships"
  | "activating"
  | "create_venue"
  | "render";

export function orgGateDecision(state: OrgGateState): OrgGateDecision {
  if (!state.userLoaded || !state.orgLoaded || !state.listLoaded) return "loading";
  if (!state.isSignedIn) return "sign_in";
  if (state.hasOrganization) return "render";
  if (state.hasMembership) return "activating";
  if (state.membershipsPending) return "wait_for_memberships";
  return state.requireOrganization ? "create_venue" : "render";
}
