import { SiteHeader, SiteFooter } from "@/components/layout/SiteChrome";

/** Placeholder: the full privacy policy is written in a later workstream. */
export default function PrivacyPage() {
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="page-width py-16">
        <p className="eyebrow">Privacy</p>
        <h1 className="mt-4 text-4xl font-semibold">How Dreemer handles photos</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          The photos a couple uploads are used only to make their gallery at the
          venue they chose, and for nothing else. A full privacy policy is on
          its way.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
