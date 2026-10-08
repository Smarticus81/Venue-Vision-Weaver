import { ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { Link } from "wouter";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";
import { PricingCards } from "@/components/landing/PricingCards";
import { Faq } from "@/components/landing/Faq";
import { formatMoney, perGalleryPrice, usePublicConfig } from "@/lib/publicConfig";
import { track, trackOnce } from "@/lib/track";

/** /pricing: the same cards and FAQ as the landing page, for links from emails and search. */
export default function PricingPage() {
  const config = usePublicConfig();
  const { pricing, trial } = config;

  useEffect(() => {
    trackOnce("landing_view:/pricing", "landing_view", { page: "/pricing" });
  }, []);

  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content">
        <section className="page-intro page-width">
          <p className="eyebrow">Pricing</p>
          <h1>Plans and prices</h1>
          <p>
            One credit is one couple's gallery: four images and a short reel at your venue, delivered
            to a private page with your date link. Credits are shared across every venue on your
            account. Monthly billing, cancel any time.
          </p>
        </section>

        <section className="pricing-section page-width" aria-labelledby="pricing-heading" id="pricing">
          <h2 id="pricing-heading" className="sr-only">
            Plans
          </h2>
          <PricingCards pricing={pricing} trial={trial} placement="pricing_page" />
          <p className="section-copy mt-6">
            Per couple that works out to about{" "}
            {formatMoney(perGalleryPrice(pricing.starterMonthly, pricing.starterCredits), pricing.currency)} on
            Starter and {formatMoney(perGalleryPrice(pricing.growthMonthly, pricing.growthCredits), pricing.currency)}{" "}
            on Growth. Put that next to what one booked date is worth to your venue.
          </p>
        </section>

        <Faq config={config} heading="What venues ask before they pick a plan." />

        <section className="start-section page-width">
          <p className="eyebrow">Start today</p>
          <h2>Try it on your next tour.</h2>
          <Link
            href="/create-venue"
            className="action-primary"
            data-testid="pricing-start-free"
            onClick={() => track("cta_click", { placement: "pricing_final_ask" })}
          >
            Start free <ArrowRight size={18} aria-hidden />
          </Link>
          <p className="caption">
            {trial.credits} galleries free, {trial.days} days, no card. Pick a plan when you are ready.
          </p>
          <Link href="/login" className="text-link">
            Already set up? Sign in
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
