import { Link, useLocation } from "wouter";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import type { ReactNode } from "react";
export function SiteHeader() {
  const [path] = useLocation();
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header page-width">
        <GlimpseLogo />
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
            Get started <span aria-hidden>↗</span>
          </Link>
        </nav>
      </header>
    </>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer page-width">
      <GlimpseLogo />
      <p>A glimpse of what could be.</p>
      <Link href="/find-my-gallery">Find my gallery</Link>
      <span>© {new Date().getFullYear()} glimpse</span>
    </footer>
  );
}
export function FormLayout({
  children,
  title,
  description,
  label = "Your next chapter",
}: {
  children: ReactNode;
  title: string;
  description: string;
  label?: string;
}) {
  return (
    <div className="site-page">
      <SiteHeader />
      <main id="main-content" className="form-layout page-width">
        <aside>
          <p className="eyebrow">{label}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="form-aside-note">
            A little imagination.
            <br />
            <em>A place to begin.</em>
          </div>
        </aside>
        <div className="form-content">{children}</div>
      </main>
      <SiteFooter />
    </div>
  );
}
