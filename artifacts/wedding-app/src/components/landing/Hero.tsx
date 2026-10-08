import { ArrowRight, Check } from "lucide-react";
import { Link } from "wouter";
import type { TrialConfig } from "@workspace/api-client-react";
import { HERO_IMAGE } from "@/lib/brandAssets";
import { track } from "@/lib/track";

/*
 * Hero (funnel-ux.md 3.2, fallback variant). No same-composition before/after
 * pair exists among the committed assets, so the reveal handle is not built;
 * the figure is the committed diptych — the empty space on the left, the
 * couple in it on the right — which carries the same argument statically.
 * Nothing here waits on JavaScript: the headline, the CTA and the image are
 * in the first paint, and the image is the LCP element.
 */
export function Hero({ trial }: { trial: TrialConfig }) {
  return (
    <section className="venue-hero page-width">
      <div className="hero-copy">
        <p className="eyebrow">For wedding venues</p>
        <h1>
          Turn tours
          <br />
          into <em>bookings.</em>
        </h1>
        <p className="hero-description">
          A couple tours your venue. Before they leave, they see realistic images and a short reel of
          themselves getting married there, with your date link attached. They send it to family.
          They pick you.
        </p>
        <div className="action-row">
          <Link
            href="/create-venue"
            className="action-primary"
            data-testid="venue-hero-register"
            onClick={() => track("cta_click", { placement: "hero" })}
          >
            Start free — {trial.credits} galleries <ArrowRight size={18} aria-hidden />
          </Link>
          <a href="#how-it-works" className="text-link">
            See how it works
          </a>
        </div>
        <p className="hero-note">
          <Check size={15} aria-hidden /> No card. Setup takes a few minutes. {trial.days}-day trial.
        </p>
      </div>
      <figure className="hero-photo">
        <img
          src={HERO_IMAGE.src}
          srcSet={HERO_IMAGE.srcSet}
          sizes={HERO_IMAGE.sizes}
          width={HERO_IMAGE.width}
          height={HERO_IMAGE.height}
          alt={HERO_IMAGE.alt}
          fetchPriority="high"
          loading="eager"
          decoding="async"
        />
        <figcaption>
          <span>An example venue, empty</span>
          <span>The couple in it · AI preview</span>
        </figcaption>
      </figure>
    </section>
  );
}
