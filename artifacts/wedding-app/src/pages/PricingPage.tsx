import { Link } from "wouter";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";

/** Placeholder: the plan catalog (GET /billing/plans) lands here in a later workstream. */
export default function PricingPage() {
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="page-width py-16">
        <p className="eyebrow">Pricing</p>
        <h1 className="mt-4 text-4xl font-semibold">Plans and prices</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Plans and prices are on the home page for now.{" "}
          <Link href="/#plans" className="text-link" data-testid="pricing-plans-link">
            See plans →
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
