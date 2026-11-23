import { Link } from "wouter";
import type { TrialConfig } from "@workspace/api-client-react";
import { COMPARE_IMAGES } from "@/lib/brandAssets";
import { track } from "@/lib/track";

/*
 * Architectural album cover. Reference and preview are different compositions,
 * clearly labelled, never presented as an aligned before/after comparison.
 */
export function Hero({ trial }: { trial: TrialConfig }) {
  return (
    <section className="album-hero page-width" aria-labelledby="hero-heading">
      <div className="album-hero__copy">
        <p className="eyebrow">A new way to remember the venue tour</p>
        <h1 id="hero-heading">Let them see<br />their day <em>here.</em></h1>
        <p className="album-hero__description">Your venue. The two of them. A wedding they can picture.</p>
        <p className="album-hero__detail">Create personalized wedding galleries from your venue photos and the couple's own pictures—with a motion reel to share and your date link built in.</p>
        <div className="action-row">
          <Link
            href="/create-venue"
            className="action-primary"
            data-testid="venue-hero-register"
            onClick={() => track("cta_click", { placement: "hero" })}
          >
            Create your first gallery
          </Link>
          <a href="#gallery-examples" className="text-link">
            Explore the examples
          </a>
        </div>
        <p className="album-hero__terms">{trial.credits} galleries included · {trial.days} days free · No card needed</p>
      </div>
      <div className="album-hero__visual">
        <figure className="album-portrait">
          <img {...COMPARE_IMAGES.couple} fetchPriority="high" loading="eager" decoding="async" />
          <figcaption><span>A possibility worth picturing</span><strong>Imagined here.</strong></figcaption>
        </figure>
        <div className="album-source">
          <img {...COMPARE_IMAGES.room} loading="lazy" decoding="async" />
          <div><span>The starting point</span><strong>The venue's own photos</strong></div>
        </div>
        <p className="album-hero__disclosure">Example venue &amp; demo couple · generated preview</p>
      </div>
    </section>
  );
}
