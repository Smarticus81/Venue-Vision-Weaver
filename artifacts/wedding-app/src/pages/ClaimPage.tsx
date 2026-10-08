import { ArrowRight } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Link, useParams } from "wouter";
import { getGetOutreachClaimQueryKey, useGetOutreachClaim, type ErrorType } from "@workspace/api-client-react";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { usePublicConfig } from "@/lib/publicConfig";
import { rememberFirstTouch, track, trackOnce } from "@/lib/track";

/*
 * /claim/:token — where a prospect lands from an outreach email. Resolves the
 * token (GET /outreach/claim/{token}) to the venue we wrote to, shows the
 * venue its own photos, and routes into /create-venue with the claim token
 * and the venue details prefilled. The first touch is recorded as "claim" so
 * the signup is attributed to the email.
 */

/** Build the signup URL the claim page hands off to. Exported for reuse and tests. */
export function claimSignupHref(token: string, venue?: { venueName?: string | null; website?: string | null }): string {
  const params = new URLSearchParams();
  params.set("claim", token);
  if (venue?.venueName) params.set("venue", venue.venueName);
  if (venue?.website) params.set("website", venue.website);
  return `/create-venue?${params.toString()}`;
}

export default function ClaimPage() {
  const { token = "" } = useParams<{ token: string }>();
  const config = usePublicConfig();
  const claim = useGetOutreachClaim(token, {
    query: {
      queryKey: getGetOutreachClaimQueryKey(token),
      enabled: token.length > 0,
      retry: 1,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    rememberFirstTouch();
    trackOnce(`landing_view:/claim`, "landing_view", { page: "/claim", claimToken: token });
  }, [token]);

  const status = useMemo(() => {
    if (!token) return "missing" as const;
    if (claim.isPending) return "loading" as const;
    if (claim.isError) {
      const err = claim.error as ErrorType<unknown>;
      return err && typeof err === "object" && "status" in err && err.status === 404
        ? ("not_found" as const)
        : ("unavailable" as const);
    }
    return "ready" as const;
  }, [token, claim.isPending, claim.isError, claim.error]);

  const venue = claim.data;
  const signupHref = claimSignupHref(token, venue);
  const photos = (venue?.photoUrls ?? []).slice(0, 3);
  const websiteHost = hostOf(venue?.website);

  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="claim-page page-width" data-claim-token={token}>
        {status === "loading" ? (
          <section className="claim-copy">
            <p className="eyebrow">Your invitation</p>
            <h1>Opening your invitation</h1>
            <p role="status">One moment while we find your venue…</p>
          </section>
        ) : status === "ready" && venue ? (
          <>
            <section className="claim-copy">
              <p className="eyebrow">Your invitation</p>
              <h1>
                {venue.venueName}, this is what your couples could take home.
              </h1>
              <p>
                We wrote to you because {venue.venueName}
                {venue.region ? ` in ${venue.region}` : ""} is the kind of venue couples tour and then
                compare on feel. Dreemer shows a touring couple realistic images and a short reel of
                themselves getting married at your spaces, with your date link attached, before they
                tour the next place.
              </p>
              <div className="action-row">
                <Link
                  href={signupHref}
                  className="action-primary"
                  data-testid="claim-start-free"
                  onClick={() => track("cta_click", { placement: "claim", prospectId: venue.prospectId })}
                >
                  Claim your free trial <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href="/#how-it-works" className="text-link">
                  See how it works
                </Link>
              </div>
              <p className="hero-note">
                {config.trial.credits} galleries free, {config.trial.days} days, no card. Your venue name
                {websiteHost ? ` and ${websiteHost}` : ""} are already filled in.
              </p>
            </section>
            {photos.length > 0 ? (
              <figure className="claim-photos" aria-label={`Photos from ${venue.venueName}'s website`}>
                <div className={`claim-photo-grid count-${photos.length}`}>
                  {photos.map((url, i) => (
                    <img
                      key={url}
                      src={url}
                      alt={`${venue.venueName}${i === 0 ? ", from its website" : ""}`}
                      loading={i === 0 ? "eager" : "lazy"}
                      decoding="async"
                    />
                  ))}
                </div>
                <figcaption>
                  Your spaces, from {websiteHost ?? "your website"}. These become the references for
                  your couples' previews; you confirm or replace them at setup.
                </figcaption>
              </figure>
            ) : (
              <aside className="claim-aside">
                <strong>What happens at setup</strong>
                We pull photos of your spaces from your website for you to confirm, you add your
                booking link, and you print the tour card. A few minutes.
              </aside>
            )}
          </>
        ) : (
          <section className="claim-copy">
            <p className="eyebrow">Your invitation</p>
            <h1>
              {status === "not_found"
                ? "This invitation link has expired."
                : status === "missing"
                  ? "This link is missing its invitation code."
                  : "We could not open your invitation right now."}
            </h1>
            <p>
              {status === "not_found"
                ? "The link in your email was used already or is no longer valid. You can still start free in a couple of minutes; it is the same trial."
                : status === "missing"
                  ? "Open the link from the email we sent you, or start free below; it is the same trial."
                  : "Our side is having trouble, not yours. Start free below and your invitation details will be matched to your account later, or try the link again in a few minutes."}
            </p>
            <div className="action-row">
              <Link
                href={token ? signupHref : "/create-venue"}
                className="action-primary"
                data-testid="claim-start-free"
                onClick={() => track("cta_click", { placement: "claim_fallback", status })}
              >
                Start free <ArrowRight size={18} aria-hidden />
              </Link>
              {status === "unavailable" ? (
                <button type="button" className="text-link" onClick={() => void claim.refetch()}>
                  Try again
                </button>
              ) : (
                <Link href="/" className="text-link">
                  See how Dreemer works
                </Link>
              )}
            </div>
            <p className="hero-note">
              {config.trial.credits} galleries free, {config.trial.days} days, no card.
            </p>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
