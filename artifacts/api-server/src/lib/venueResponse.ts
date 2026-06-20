import type { Venue } from "@workspace/db";

export function publicContactFields(venue: Venue) {
  return {
    contactEmail: venue.contactEmail,
    contactPhone: venue.contactPhone,
    websiteUrl: venue.websiteUrl,
    bookingUrl: venue.bookingUrl,
  };
}

export function ownerVenueResponse(venue: Venue) {
  return {
    id: venue.id,
    name: venue.name,
    slug: venue.slug,
    tagline: venue.tagline,
    description: venue.description,
    ...publicContactFields(venue),
    ownerEmail: venue.ownerEmail,
    plan: venue.plan,
    creditsBalance: venue.creditsBalance,
    billingPeriodEnd: venue.billingPeriodEnd,
    createdAt: venue.createdAt,
  };
}
