import type { ReactNode } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * The hero: a single 100svh viewport with the supplied venue film
 * looping quietly behind the editorial lockup. No scroll scrubbing,
 * no pinning — the footage is ambience, the copy carries the pitch.
 *
 * Reduced motion swaps the video for its poster still; the layout is
 * otherwise identical.
 */

const HERO_POSTER = "/brand/hero-atmosphere.webp";

export function VideoHero({
  onSignIn,
  startCta,
}: {
  onSignIn: () => void;
  /** The primary CTA button, supplied by the page so styling stays shared. */
  startCta: ReactNode;
}) {
  const reduce = useReducedMotion() ?? false;

  return (
    <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden">
      {/* z-0: the film — full bleed, cover, looping. */}
      {reduce ? (
        <img
          src={HERO_POSTER}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "50% 42%" }}
        />
      ) : (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster={HERO_POSTER}
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "50% 42%" }}
        >
          <source src="/brand/hero.webm" type="video/webm" />
          <source src="/brand/hero.mp4" type="video/mp4" />
        </video>
      )}

      {/* z-1: the gentlest possible readability veil. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.18), rgba(0,0,0,0.02) 45%, rgba(0,0,0,0.32))",
        }}
      />

      {/* z-2: the editorial lockup, bottom-left. */}
      <div className="relative z-[2] mx-auto w-full max-w-7xl px-5 pb-16 pt-36 md:px-8 md:pb-24">
        <h1 className="sr-only">Turn tours into bookings</h1>
        <p className="lp-eyebrow lp-accent">For wedding venues</p>
        <div
          aria-hidden
          className="lp-display mt-5 max-w-3xl text-[clamp(2.8rem,7.5vw,6.5rem)] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]"
        >
          Turn tours into <em className="lp-accent">bookings.</em>
        </div>
        <p className="mt-5 max-w-md text-base leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.4)]">
          Let couples see themselves here. Four portraits and a motion reel of
          their wedding — at your venue, before they've booked it.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          {startCta}
          <button
            type="button"
            onClick={onSignIn}
            data-testid="owner-cta"
            className="rounded-sm text-sm text-white/85 underline-offset-4 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [text-shadow:0_1px_10px_rgba(0,0,0,0.4)]"
          >
            Already set up? Sign in
          </button>
        </div>
        <p className="mt-5 text-[13px] text-white/70 [text-shadow:0_1px_10px_rgba(0,0,0,0.4)]">
          5 free galleries to start · 1 credit = 1 couple's gallery
        </p>
      </div>
    </section>
  );
}
