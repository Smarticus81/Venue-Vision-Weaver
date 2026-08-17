import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * The cinematic hero: a 450vh scroll section whose pinned, full-bleed
 * background is the venue-transformation film. Scroll is the playhead —
 * the couple tours the undecorated venue, and as the visitor scrolls,
 * the wedding materializes around them. The transition lives in the
 * footage itself; nothing synthetic is layered on top.
 *
 * Scroll → video-time mapping (piecewise, tuned to the footage):
 *   0–8%    hold the opening frame (the tour registers first)
 *   8–42%   the walk (video 0 → 0.36)
 *   42–74%  the transformation dissolve (video 0.36 → 0.60) — the
 *           emotional centerpiece gets the most scroll distance
 *   74–92%  into the wedding (video 0.60 → end)
 *   92–100% hold the completed wedding
 *
 * Scrubbing never re-renders React: scroll writes a target ref and a
 * rAF loop (gated by an IntersectionObserver) eases video.currentTime
 * toward it.
 */

const TIMELINE: [number, number][] = [
  [0, 0.004],
  [0.08, 0.004],
  [0.42, 0.36],
  [0.74, 0.6],
  [0.92, 0.995],
  [1, 0.995],
];

function mapScrollToVideo(p: number): number {
  const v = Math.min(1, Math.max(0, p));
  for (let i = 0; i < TIMELINE.length - 1; i++) {
    const [s0, t0] = TIMELINE[i];
    const [s1, t1] = TIMELINE[i + 1];
    if (v >= s0 && v <= s1) {
      const f = s1 === s0 ? 0 : (v - s0) / (s1 - s0);
      return t0 + (t1 - t0) * f;
    }
  }
  return TIMELINE[TIMELINE.length - 1][1];
}

export function CinematicHero({
  onStart,
  onSignIn,
  startCta,
}: {
  onStart: () => void;
  onSignIn: () => void;
  /** The primary CTA button, supplied by the page so styling stays shared. */
  startCta: ReactNode;
}) {
  const reduce = useReducedMotion() ?? false;
  const sectionRef = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetTime = useRef(0.004);
  const [finalActive, setFinalActive] = useState(false);

  const { scrollYProgress } = useScroll({
    target: sectionRef as React.RefObject<HTMLElement>,
    offset: ["start start", "end end"],
  });

  // Copy choreography — MotionValues only, no per-frame re-renders.
  const openingOpacity = useTransform(scrollYProgress, [0, 0.34, 0.48], [1, 1, 0]);
  const openingY = useTransform(scrollYProgress, [0, 0.48], [0, -36]);
  const finalOpacity = useTransform(scrollYProgress, [0.86, 0.94], [0, 1]);
  const cueOpacity = useTransform(scrollYProgress, [0, 0.06], [1, 0]);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (reduce) return;
    targetTime.current = mapScrollToVideo(v);
    // One rare state flip so the final CTA becomes clickable exactly
    // when it is visible.
    setFinalActive((prev) => {
      const next = v >= 0.86;
      return prev === next ? prev : next;
    });
  });

  // Prime the first frame once metadata is in (iOS/Safari render a
  // frame reliably after a muted play/pause cycle).
  useEffect(() => {
    if (reduce) return;
    const vid = videoRef.current;
    if (!vid) return;
    const prime = () => {
      const p = vid.play();
      if (p) {
        p.then(() => {
          vid.pause();
          vid.currentTime = targetTime.current * Math.max(0, vid.duration - 0.05);
        }).catch(() => {
          vid.currentTime = targetTime.current * Math.max(0, vid.duration - 0.05);
        });
      }
    };
    if (vid.readyState >= 2) prime();
    else vid.addEventListener("loadeddata", prime, { once: true });
    return () => vid.removeEventListener("loadeddata", prime);
  }, [reduce]);

  // The scrub loop: eased pursuit of the scroll target, running only
  // while the cinematic section is on screen.
  useEffect(() => {
    if (reduce) return;
    const section = sectionRef.current;
    if (!section) return;
    let raf = 0;
    let running = false;
    let cur = targetTime.current;

    const tick = () => {
      if (!running) return;
      const vid = videoRef.current;
      if (vid && Number.isFinite(vid.duration) && vid.duration > 0) {
        cur += (targetTime.current - cur) * 0.12;
        const t = cur * Math.max(0, vid.duration - 0.05);
        if (Math.abs(vid.currentTime - t) > 1 / 48 && vid.readyState >= 2) {
          vid.currentTime = t;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        raf = requestAnimationFrame(tick);
      } else if (!entry.isIntersecting && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    });
    io.observe(section);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [reduce]);

  /* Reduced motion: the completed wedding as a still, copy fully
     present, nothing scrubs. */
  if (reduce) {
    return (
      <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden">
        <img
          src="/media/glimpse-venue-transformation-final.webp"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "50% 40%" }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.18), rgba(0,0,0,0.02) 45%, rgba(0,0,0,0.32))",
          }}
        />
        <div className="relative z-[2] mx-auto w-full max-w-7xl px-5 pb-20 pt-36 md:px-8">
          <h1 className="sr-only">Turn tours into bookings</h1>
          <p className="lp-eyebrow lp-accent">For wedding venues</p>
          <div aria-hidden className="lp-display mt-5 max-w-3xl text-[clamp(2.8rem,7.5vw,6.5rem)] text-white">
            Turn tours into <em className="lp-accent">bookings.</em>
          </div>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/85">
            Let couples see themselves here. Four portraits and a motion reel
            of their wedding — at your venue, before they've booked it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            {startCta}
            <button
              type="button"
              onClick={onSignIn}
              data-testid="owner-cta"
              className="rounded-sm text-sm text-white/80 underline-offset-4 hover:text-white hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Already set up? Sign in
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={sectionRef} className="relative" style={{ height: "450vh" }}>
      <div className="sticky top-0 overflow-hidden" style={{ height: "100svh" }}>
        {/* z-0: the film. Full bleed, cover, no container. */}
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          poster="/media/glimpse-venue-transformation-poster.webp"
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: "50% 42%" }}
        >
          <source src="/media/glimpse-venue-transformation-web.webm" type="video/webm" />
          <source src="/media/glimpse-venue-transformation-web.mp4" type="video/mp4" />
        </video>

        {/* z-1: the gentlest possible readability veil. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0.16), rgba(0,0,0,0.02) 42%, rgba(0,0,0,0.14))",
          }}
        />

        {/* z-2: opening copy — present while the couple tours, gone by
            the transformation. */}
        <motion.div
          className="absolute inset-x-0 bottom-0 z-[2] mx-auto w-full max-w-7xl px-5 pb-16 md:px-8 md:pb-24"
          style={{ opacity: openingOpacity, y: openingY }}
        >
          <h1 className="sr-only">Turn tours into bookings</h1>
          <p className="lp-eyebrow lp-accent">For wedding venues</p>
          <div
            aria-hidden
            className="lp-display mt-5 max-w-3xl text-[clamp(2.8rem,7.5vw,6.5rem)] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.35)]"
          >
            Turn tours into <em className="lp-accent">bookings.</em>
          </div>
          <p className="mt-5 max-w-md text-base leading-relaxed text-white/90 [text-shadow:0_1px_12px_rgba(0,0,0,0.4)]">
            Let couples see themselves here.
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
        </motion.div>

        {/* z-2: final copy — settles in once the wedding is complete. */}
        <motion.div
          className={cn(
            "absolute inset-x-0 bottom-0 z-[2] mx-auto w-full max-w-7xl px-5 pb-16 md:px-8 md:pb-24",
            !finalActive && "pointer-events-none",
          )}
          style={{ opacity: finalOpacity }}
        >
          <p
            aria-hidden={!finalActive}
            className="lp-display max-w-xl text-[clamp(2rem,5vw,4rem)] text-white [text-shadow:0_2px_24px_rgba(0,0,0,0.45)]"
          >
            Make the tour <em className="lp-accent">unforgettable.</em>
          </p>
          <a
            href="#how-it-works"
            tabIndex={finalActive ? 0 : -1}
            className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/25 px-6 py-3 text-sm font-medium text-white backdrop-blur-md transition-colors hover:bg-black/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            See how glimpse works →
          </a>
        </motion.div>

        {/* Scroll cue, gone at first movement. */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute bottom-6 left-1/2 z-[2] -translate-x-1/2"
          style={{ opacity: cueOpacity }}
        >
          <div className="lp-scroll-cue flex flex-col items-center gap-2 text-white/75">
            <span className="lp-eyebrow [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]">Scroll</span>
            <span className="h-8 w-px bg-white/60" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}
