import type { Venue, Organization } from "@workspace/db";
import { MIN_VENUE_REFERENCES } from "./referenceImage.js";
import { venueMediaCoverageStatus, type VenueMediaCoverage } from "./venueMediaCoverage.js";

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
    incentiveText: venue.incentiveText,
    tourCardDownloadedAt: venue.tourCardDownloadedAt,
    websiteImportedAt: venue.websiteImportedAt,
    plan: org ? org.plan : venue.plan,
    creditsBalance: org ? org.creditsBalance : venue.creditsBalance,
    billingPeriodEnd: org ? org.billingPeriodEnd : venue.billingPeriodEnd,
    createdAt: venue.createdAt,
  };
}

type MediaCoverageRow = { coverage?: string | null };

/**
 * The one venue-readiness rule: enough reference photos for generation AND
 * every coverage role present. The session-create guard, the public venue
 * payload and the dashboard checklist all read this.
 */
export function isVenueReady(media: ReadonlyArray<MediaCoverageRow>): boolean {
  return media.length >= MIN_VENUE_REFERENCES && venueMediaCoverageStatus([...media]).ready;
}

/** Coverage roles the venue still lacks reference photos for (empty when ready). */
export function missingVenueCoverages(media: ReadonlyArray<MediaCoverageRow>): VenueMediaCoverage[] {
  return venueMediaCoverageStatus([...media]).missing;
}

/** Cloudflare Turnstile site key when bot protection is configured; null otherwise. */
export function turnstileSiteKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.TURNSTILE_SECRET_KEY?.trim() && env.TURNSTILE_SITE_KEY?.trim()
    ? env.TURNSTILE_SITE_KEY.trim()
    : null;
}

/** True when the share-page date CTA has somewhere to send the couple. */
export function isBookingReady(venue: {
  bookingUrl: string | null;
  websiteUrl: string | null;
  contactEmail: string | null;
}): boolean {
  return Boolean(venue.bookingUrl?.trim() || venue.websiteUrl?.trim() || venue.contactEmail?.trim());
}

/** Couple-safe venue payload - no billing fields. */
export function toPublicVenue(
  venue: {
    id: number;
    name: string;
    slug: string;
    tagline: string | null;
    description: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    websiteUrl: string | null;
    bookingUrl: string | null;
    incentiveText?: string | null;
    createdAt: Date;
  },
  media: Array<MediaCoverageRow>,
) {
  return {
    id: venue.id,
    name: venue.name,
    slug: venue.slug,
    tagline: venue.tagline,
    description: venue.description,
    contactEmail: venue.contactEmail,
    contactPhone: venue.contactPhone,
    websiteUrl: venue.websiteUrl,
    bookingUrl: venue.bookingUrl,
    incentiveText: venue.incentiveText ?? null,
    createdAt: venue.createdAt,
    media,
    isReady: isVenueReady(media),
    bookingReady: isBookingReady(venue),
    missingCoverages: missingVenueCoverages(media),
    turnstileSiteKey: turnstileSiteKey(),
  };
}
