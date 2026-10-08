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

export interface BookingCta {
  label: string;
  href: string;
}

/**
 * The share-page / gallery-email date CTA (step0-merge-decisions E10):
 * "Check your date at {venue}" pointing at bookingUrl -> websiteUrl ->
 * mailto:contactEmail, carrying the couple's wedding month and utm tags.
 * Never "Book a tour" (the couple already toured). Null when the venue has
 * nowhere to send the couple yet.
 */
export function bookingCtaFor(
  venue: { name: string; bookingUrl: string | null; websiteUrl: string | null; contactEmail: string | null },
  options: { weddingMonth?: string | null; coupleName?: string | null; medium?: string } = {},
): BookingCta | null {
  const label = `Check your date at ${venue.name}`;
  const target = venue.bookingUrl?.trim() || venue.websiteUrl?.trim() || "";
  const month = options.weddingMonth?.trim() || null;
  if (target) {
    try {
      const url = new URL(target);
      url.searchParams.set("utm_source", "dreemer");
      url.searchParams.set("utm_medium", options.medium ?? "gallery");
      url.searchParams.set("utm_campaign", "hold_your_date");
      if (month) url.searchParams.set("wedding_month", month);
      return { label, href: url.toString() };
    } catch {
      /* fall through to the email fallback */
    }
  }
  const email = venue.contactEmail?.trim();
  if (!email) return null;
  const subjectParts = ["Our date at", venue.name];
  if (month) subjectParts.push(`(${month})`);
  const bodyLines = [
    `Hi ${venue.name},`,
    "",
    `We just saw our Dreemer gallery and would like to check availability${month ? ` for ${month}` : ""}.`,
  ];
  if (options.coupleName?.trim()) bodyLines.push("", options.coupleName.trim());
  const params = new URLSearchParams({ subject: subjectParts.join(" "), body: bodyLines.join("\n") });
  return { label, href: `mailto:${email}?${params.toString().replace(/\+/g, "%20")}` };
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
