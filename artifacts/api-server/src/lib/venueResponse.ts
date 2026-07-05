import type { Venue, Organization } from "@workspace/db";

export function publicContactFields(venue: Venue) {
  return {
    contactEmail: venue.contactEmail,
    contactPhone: venue.contactPhone,
    websiteUrl: venue.websiteUrl,
    bookingUrl: venue.bookingUrl,
  };
}

/**
 * Owner-facing venue payload. Billing fields (plan/credits/period) belong to
 * the organization; pass the org row where the response should carry live
 * billing numbers. Without it, legacy venue-level values are surfaced (only
 * meaningful for not-yet-adopted venues).
 */
export function ownerVenueResponse(venue: Venue, org?: Organization | null) {
  return {
    id: venue.id,
    name: venue.name,
    slug: venue.slug,
    tagline: venue.tagline,
    description: venue.description,
    ...publicContactFields(venue),
    ownerEmail: venue.ownerEmail,
    organizationId: venue.organizationId,
    plan: org ? org.plan : venue.plan,
    creditsBalance: org ? org.creditsBalance : venue.creditsBalance,
    billingPeriodEnd: org ? org.billingPeriodEnd : venue.billingPeriodEnd,
    createdAt: venue.createdAt,
  };
}
