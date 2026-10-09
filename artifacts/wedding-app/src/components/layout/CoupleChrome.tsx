import type { ReactNode, Ref } from "react";
import { Link } from "wouter";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { venueMediaUrl } from "@/lib/shareSession";

/*
 * Couple-facing chrome for /preview/:slug and /v/:shareToken. These pages are
 * the venue's sales asset, so the venue owns the header: its name and one of
 * its own photos. Dreemer appears once, quietly, as an unlinked "Powered by"
 * wordmark in the footer. No sign-in, no signup, no owner navigation.
 */

export interface CoupleChromeVenue {
  name: string;
  slug: string;
  media?: ReadonlyArray<{ objectKey: string }>;
}

export function CoupleChrome({
  venue,
  eyebrow = "Your preview at",
  action,
  children,
  mainRef,
  mainClassName,
  footerNote,
}: {
  venue: CoupleChromeVenue | null;
  /** Small label above the venue name. */
  eyebrow?: string;
  /** Optional right-hand header slot (the gallery's compact date CTA). */
  action?: ReactNode;
  children: ReactNode;
  mainRef?: Ref<HTMLElement>;
  mainClassName?: string;
  /** Extra footer line, e.g. the AI-preview disclosure. */
  footerNote?: ReactNode;
}) {
  const thumb = venue?.media?.[0]?.objectKey;
  return (
    <div className="cc-page">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="cc-header">
        <div className="cc-header__inner">
          <div className="cc-venue">
            {thumb && venue ? (
              <img
                className="cc-venue__thumb"
                src={venueMediaUrl(thumb, venue.slug)}
                alt=""
                width={40}
                height={40}
                decoding="async"
              />
            ) : (
              <span className="cc-venue__thumb cc-venue__thumb--empty" aria-hidden />
            )}
            <span className="cc-venue__text">
              <span className="cc-venue__eyebrow">{eyebrow}</span>
              <span className="cc-venue__name" data-testid="couple-venue-name">
                {venue?.name ?? "Your venue"}
              </span>
            </span>
          </div>
          {action ? <div className="cc-header__action">{action}</div> : null}
        </div>
      </header>
      <main id="main-content" ref={mainRef} tabIndex={-1} className={mainClassName}>
        {children}
      </main>
      <footer className="cc-footer">
        <div className="cc-footer__inner">
          {footerNote ? <p className="cc-footer__note">{footerNote}</p> : null}
          <nav className="cc-footer__links" aria-label="Footer">
            <Link href="/privacy">Privacy &amp; AI previews</Link>
          </nav>
          <p className="cc-powered">
            <span>Powered by</span>
            <DreemerLogo href={null} variant="wordmark" tone="mono" className="cc-powered__logo" />
          </p>
        </div>
      </footer>
    </div>
  );
}
