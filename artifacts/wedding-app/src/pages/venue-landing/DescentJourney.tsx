import { useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { journeyElevation, journeyStage, ARRIVAL_THRESHOLD } from "./journey";

const CHAPTERS = [
  {
    num: "Chapter 01",
    title: "The approach",
    text: "Every venue decision starts as a daydream — somewhere above the paperwork. Scroll to descend.",
  },
  {
    num: "Chapter 02",
    title: "Through the timberline",
    text: "Golden aspens, dark firs, mist off the ridge. The feeling is the product.",
  },
  {
    num: "Chapter 03",
    title: "The valley plateau",
    text: "The garden opens below: string lights, flowers, one aisle, a view that does the selling.",
  },
  {
    num: "Chapter 04",
    title: "The threshold",
    text: "The altar. This is what glimpse hands a couple after the tour — themselves, standing here.",
  },
] as const;

const CHAPTER_RANGES: [number, number][] = [
  [0, 0.22],
  [0.22, 0.56],
  [0.56, 0.87],
  [0.87, 1.01],
];

function chapterIndex(p: number): number {
  for (let i = 0; i < CHAPTER_RANGES.length; i++) {
    if (p >= CHAPTER_RANGES[i][0] && p < CHAPTER_RANGES[i][1]) return i;
  }
  return CHAPTER_RANGES.length - 1;
}

/**
 * The descent — a 480vh scroll flight narrated over the page-background
 * footage (see FlightBackdrop): the film descends from the night sky to
 * the candlelit altar while chapter cards, an elevation/cam HUD, and a
 * progress rail ride on top. Nothing synthetic is rendered over the
 * footage — the video is the scene. Reduced motion swaps the flight
 * for a still of the altar and the chapters as text.
 */
export function DescentJourney() {
  const reduce = useReducedMotion() ?? false;
  const wrapRef = useRef<HTMLElement | null>(null);
  const [chapter, setChapter] = useState(0);
  const [arrived, setArrived] = useState(false);

  const { scrollYProgress } = useScroll({
    target: wrapRef as React.RefObject<HTMLElement>,
    offset: ["start start", "end end"],
  });
  const elevText = useTransform(scrollYProgress, (v) => journeyElevation(v));
  const stateText = useTransform(scrollYProgress, (v) => journeyStage(v).state);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (reduce) return;
    const idx = chapterIndex(v);
    setChapter((prev) => (prev === idx ? prev : idx));
    setArrived((prev) => {
      const next = v >= ARRIVAL_THRESHOLD;
      return prev === next ? prev : next;
    });
  });

  const header = (
    <div className="mx-auto max-w-7xl px-5 pb-14 md:px-8">
      <p className="lp-eyebrow lp-accent">The venue, from above</p>
      <h2 className="lp-display mt-6 text-[clamp(2.2rem,5.4vw,4.8rem)] text-foreground">
        Fly the approach. Then <em className="lp-accent">stand</em> where
        they'll stand.
      </h2>
      <p className="mt-6 max-w-xl leading-relaxed text-foreground/70">
        {reduce
          ? "From the ridge down to the candlelit altar — the feeling glimpse delivers to their phone."
          : "Scroll to descend from the ridge to the altar. This is the feeling glimpse delivers to their phone."}
      </p>
    </div>
  );

  if (reduce) {
    return (
      <section id="ceremony" className="py-28 md:py-40">
        {header}
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div className="relative h-[62vh] min-h-[26rem] overflow-hidden rounded-3xl border border-white/10">
            <img
              src="/brand/descent-altar.webp"
              alt="A candlelit hilltop wedding altar with string lights, surrounded by flowers and mountains at night"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-2">
            {CHAPTERS.map((c) => (
              <div key={c.num}>
                <p className="lp-eyebrow lp-accent">{c.num}</p>
                <h3 className="lp-display mt-2 text-2xl text-foreground">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/65">{c.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="ceremony" className="pt-28 md:pt-40">
      {header}

      <section ref={wrapRef} id="descent-track" className="relative" style={{ height: "480vh" }}>
        <div className="sticky top-0 h-screen overflow-hidden">
          {/* HUD */}
          <div className="pointer-events-none absolute inset-x-0 top-20 z-10 flex items-center justify-between px-5 md:top-24 md:px-10">
            <p className="lp-eyebrow lp-accent">The descent</p>
            <div className="lp-eyebrow hidden gap-8 text-foreground/50 sm:flex">
              <span>
                Elevation{" "}
                <motion.span className="lp-accent tabular-nums">{elevText}</motion.span>
              </span>
              <span>
                Cam <motion.span className="lp-accent">{stateText}</motion.span>
              </span>
            </div>
          </div>

          {/* Progress rail */}
          <div
            aria-hidden
            className="absolute right-5 top-1/2 z-10 h-44 w-px -translate-y-1/2 bg-white/15 md:right-10"
          >
            <motion.div
              className="w-px origin-top"
              style={{
                scaleY: scrollYProgress,
                height: "100%",
                background: "var(--lp-accent)",
                boxShadow: "0 0 10px var(--lp-accent)",
              }}
            />
          </div>

          {/* Chapter cards */}
          <div className="pointer-events-none absolute inset-y-0 left-5 z-10 flex w-[min(26rem,82vw)] items-center md:left-[7vw]">
            <div className="relative h-64 w-full">
              {CHAPTERS.map((c, i) => (
                <div
                  key={c.num}
                  className={cn(
                    "absolute inset-x-0 top-0 transition-all duration-700",
                    chapter === i ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0",
                  )}
                >
                  <p className="lp-eyebrow lp-accent">{c.num}</p>
                  <h3 className="lp-display mt-3 text-4xl text-foreground md:text-5xl">{c.title}</h3>
                  <p
                    className="mt-4 rounded-r-lg border-l-2 bg-[rgba(10,8,18,0.4)] p-4 text-sm leading-relaxed text-foreground/75 backdrop-blur-md"
                    style={{ borderColor: "var(--lp-accent)" }}
                  >
                    {c.text}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Scroll hint, resting once the flight lands. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-7 z-10 flex justify-center transition-opacity duration-700",
              arrived ? "opacity-0" : "opacity-100",
            )}
          >
            <div className="lp-scroll-cue flex flex-col items-center gap-2 text-foreground/50">
              <span className="lp-eyebrow">Scroll to descend</span>
              <span className="h-8 w-px bg-foreground/40" />
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
