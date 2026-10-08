import { useParams } from "wouter";
import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";

/** Placeholder: the outreach claim flow (GET /outreach/claim/{token}) lands here in a later workstream. */
export default function ClaimPage() {
  const { token } = useParams<{ token: string }>();
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="page-width py-16" data-claim-token={token}>
        <p className="eyebrow">Your invitation</p>
        <h1 className="mt-4 text-4xl font-semibold">Welcome to Dreemer</h1>
        <p role="status" className="mt-4 text-lg text-muted-foreground">
          Loading your invitation…
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
