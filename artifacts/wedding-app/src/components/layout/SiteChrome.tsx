import { Link, useLocation } from "wouter";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { usePublicConfig } from "@/lib/publicConfig";
import { track } from "@/lib/track";
import type { ReactNode } from "react";

/*
 * Owner-facing site chrome (funnel-ux.md 3.1). The header is logo + two
 * in-page anchors + Sign in + one coral Start free; below 480px the anchors
 * hide so a 360px phone shows logo, Sign in and Start free on one line.
 * Couple pages get their own chrome (CoupleChrome) so Dreemer's signup is
 * never the loudest button on a venue's conversion page.
 */

export function SiteHeader() {
  const [path] = useLocation();
  const onHome = path === "/";
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header page-width">
        <DreemerLogo />
        <nav aria-label="Main navigation">
          <a href={onHome ? "#how-it-works" : "/#how-it-works"} className="nav-anchor">
            How it works
          </a>
          <a href={onHome ? "#pricing" : "/#pricing"} className="nav-anchor">
            Pricing
          </a>
          <Link href="/login" data-testid="venue-header-sign-in">
            Sign in
          </Link>
          <Link
            href="/create-venue"
            className="nav-cta"
            data-testid="venue-header-register"
            onClick={() => track("cta_click", { placement: "header" })}
          >
            Start free
          </Link>
        </nav>
      </header>
    </>
  );
}

export function SiteFooter() {
  const config = usePublicConfig();
  return (
    <footer className="site-footer page-width">
      <DreemerLogo className="text-[1.25rem]" />
      <p>Turn tours into bookings.</p>
      <Link href="/pricing">Pricing</Link>
      <Link href="/privacy">Privacy &amp; AI previews</Link>
      <Link href="/find-my-gallery">Couples: find your gallery</Link>
      {config.contactEmail ? <a href={`mailto:${config.contactEmail}`}>Email us</a> : null}
      <span>© {new Date().getFullYear()} Dreemer</span>
    </footer>
  );
}

export function FormLayout({
  children,
  title,
  description,
  label = "Dreemer for venues",
  note,
}: {
  children: ReactNode;
  title: string;
  description: string;
  label?: string;
  /** Optional aside callout: a short heading plus one line of plain context. */
  note?: { heading: string; body: string } | null;
}) {
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="form-layout page-width">
        <aside>
          <p className="eyebrow">{label}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          {note ? (
            <div className="form-aside-note">
              <strong>{note.heading}</strong>
              {note.body}
            </div>
          ) : null}
        </aside>
        <div className="form-content">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
