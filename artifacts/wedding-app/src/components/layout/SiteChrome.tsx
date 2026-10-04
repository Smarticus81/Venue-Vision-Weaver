import { Link, useLocation } from "wouter";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import type { ReactNode } from "react";

export function SiteHeader() {
  const [path] = useLocation();
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header page-width">
        <DreemerLogo />
        <nav aria-label="Main navigation">
          <Link href="/" aria-current={path === "/" ? "page" : undefined}>
            For venues
          </Link>
          <Link
            href="/couple"
            aria-current={path === "/couple" ? "page" : undefined}
          >
            For couples
          </Link>
          <Link href="/login" data-testid="venue-header-sign-in">
            Sign in
          </Link>
          <Link
            href="/create-venue"
            className="nav-cta"
            data-testid="venue-header-register"
          >
            Start free
          </Link>
        </nav>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer page-width">
      <DreemerLogo className="text-[1.25rem]" />
      <p>Turn tours into bookings.</p>
      <Link href="/find-my-gallery">Find my gallery</Link>
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
