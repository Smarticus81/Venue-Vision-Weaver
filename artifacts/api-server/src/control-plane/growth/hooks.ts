/**
 * Server-side growth hooks called from outside the control plane.
 * Step 0 ships no-ops; the growth workstream fills the bodies (attribution
 * sweep on signup, etc.). Callers always fire-and-forget with a catch, so a
 * hook failure never breaks the request that triggered it.
 */

/** Called after a venue is created for an organization (routes/venues.ts). Growth: attributeSignups({ organizationId }). */
export async function onVenueCreated(_organizationId: number): Promise<void> {}
