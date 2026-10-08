import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { Link } from "wouter";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { Hero } from "@/components/landing/Hero";
import { ValueStrip } from "@/components/landing/ValueStrip";
import { ProofRow } from "@/components/landing/ProofRow";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { RoiCalculator } from "@/components/landing/RoiCalculator";
import { PricingCards } from "@/components/landing/PricingCards";
import { CompareStrip } from "@/components/landing/CompareStrip";
import { Faq } from "@/components/landing/Faq";
import { usePublicConfig } from "@/lib/publicConfig";
import { track, trackOnce } from "@/lib/track";

/*
 * Conversion spine: this page exists to get a wedding-venue owner or sales
 * manager to create a venue account and run their first gallery this week,
 * because a couple who sees themselves married at the venue before they tour
 * the next one is more likely to book, and the venue can finally see which
 * toured couples opened, shared, clicked for a date, and booked.
 *
 * Signature moment: "Do the math" — the ROI readout in the venue's own unit
 * (bookings and money), live as they type. Everything else is quiet: no
 * entrance reveals, no parallax, no scroll scrubbing.
 *
 * Honesty rules: prices and trial terms come from the public config (meta tag
 * or GET /public/config), proof is partner mode until opted-in aggregates
 * exist, every generated image is labelled "AI preview".
 *
 * Statically imported in App.tsx so the hero paints from the main chunk.
 */
export default function VenueLandingPage() {
  const config = usePublicConfig();

  useEffect(() => {
    trackOnce("landing_view:/", "landing_view", { page: "/" });
  }, []);

  return (
    <div className="site-page">
      <div className="hero-band">
        <SiteHeader />
      </div>
      <main id="main-content">
        <div className="hero-band">
          <Hero trial={config.trial} />
        </div>

        <ValueStrip />

        <ProofRow config={config} />

        <HowItWorks />

        <RoiCalculator pricing={config.pricing} />

        <section className="pricing-section page-width" aria-labelledby="pricing-heading" id="pricing">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Pricing</p>
              <h2 id="pricing-heading">A monthly plan, plus credits when you need them.</h2>
            </div>
            <p>
              One credit is one couple's gallery. Credits are shared across every venue on your
              account. Monthly billing, cancel any time.
            </p>
          </div>
          <PricingCards pricing={config.pricing} trial={config.trial} placement="landing_pricing" />
        </section>

        <CompareStrip />

        <Faq config={config} />

        <section className="start-section page-width">
          <p className="eyebrow">Start today</p>
          <h2>Give the next couple a reason to pick you.</h2>
          <Link
            href="/create-venue"
            className="action-primary"
            data-testid="venue-trial-register"
            onClick={() => track("cta_click", { placement: "final_ask" })}
          >
            Start free <ArrowRight size={18} aria-hidden />
          </Link>
          <p className="caption">
            {config.trial.credits} galleries free. Setup is your website, your booking link, and the
            tour card.
          </p>
          <Link href="/login" className="text-link" data-testid="venue-trial-sign-in">
            Already set up? Sign in
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
