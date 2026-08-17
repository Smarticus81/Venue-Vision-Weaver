import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { MoodDial } from "./MoodDial";
import { journeyElevation, journeyStage, ARRIVAL_THRESHOLD } from "./journey";
import type { MoodKey } from "./moods";
import type { CeremonySceneHandle, CeremonyView } from "./ceremonyScene";

const VIEW_LABELS: Record<CeremonyView, string> = {
  aisle: "Aisle",
  altar: "Altar",
  aerial: "Aerial",
};

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
    text: "The deck opens below: cedar rows, one aisle, a view that does the selling.",
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

function useCeremonyHandle(reduce: boolean, moodRef: React.RefObject<MoodKey>) {
  const wrapRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<CeremonySceneHandle | null>(null);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let cancelled = false;

    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && !handleRef.current) {
          import("./ceremonyScene").then(({ createCeremonyScene }) => {
            if (cancelled || handleRef.current) return;
            const handle = createCeremonyScene(canvas, {
              mood: moodRef.current ?? "candlelit",
              reducedMotion: reduce,
            });
            if (!handle) return;
            handleRef.current = handle;
            if (reduce) handle.setJourney(1);
            setReady(true);
          });
        }
        handleRef.current?.setActive(entry.isIntersecting);
      },
      { rootMargin: "300px" },
    );
    io.observe(wrap);

    return () => {
      cancelled = true;
      io.disconnect();
      handleRef.current?.destroy();
      handleRef.current = null;
      setReady(false);
    };
    // moodRef is a stable ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  return { wrapRef, canvasRef, handleRef, ready, inView };
}

function ViewPills({
  view,
  onView,
}: {
  view: CeremonyView;
  onView: (v: CeremonyView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Camera view"
      className="inline-flex rounded-full border border-white/10 bg-black/45 p-1 backdrop-blur-md"
    >
      {(Object.keys(VIEW_LABELS) as CeremonyView[]).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onView(v)}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4",
            view === v ? "" : "text-foreground/60 hover:text-foreground",
          )}
          style={
            view === v
              ? { background: "var(--lp-accent)", color: "var(--lp-accent-ink)" }
              : undefined
          }
        >
          {VIEW_LABELS[v]}
        </button>
      ))}
    </div>
  );
}

/**
 * The descent — a 480vh scroll flight from high aerial down to the
 * altar. The viewport is sticky; scroll drives the camera through the
 * waypoints while chapter cards and an elevation HUD narrate. At the
 * threshold the scene unlocks: view presets, orbit (desktop), and the
 * mood dial take over. Reduced motion swaps the flight for a static
 * explorable panel.
 */
export function DescentJourney({
  mood,
  onMood,
}: {
  mood: MoodKey;
  onMood: (m: MoodKey) => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const { wrapRef, canvasRef, handleRef, ready } = useCeremonyHandle(reduce, moodRef);
  const [view, setView] = useState<CeremonyView>("altar");
  const [chapter, setChapter] = useState(0);
  const [arrived, setArrived] = useState(reduce);

  const { scrollYProgress } = useScroll({
    target: wrapRef as React.RefObject<HTMLElement>,
    offset: ["start start", "end end"],
  });
  const elevText = useTransform(scrollYProgress, (v) => journeyElevation(v));
  const stateText = useTransform(scrollYProgress, (v) => journeyStage(v).state);
  // The page-background flight footage carries the descent; the live
  // WebGL ceremony crossfades in above it at the threshold.
  const canvasOpacity = useTransform(scrollYProgress, [0.8, 0.93], [0, 1]);

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    if (reduce) return;
    handleRef.current?.setJourney(v);
    const idx = chapterIndex(v);
    setChapter((prev) => (prev === idx ? prev : idx));
    setArrived((prev) => {
      const next = v >= ARRIVAL_THRESHOLD;
      return prev === next ? prev : next;
    });
  });

  useEffect(() => {
    handleRef.current?.setMood(mood);
  }, [mood, ready, handleRef]);

  const pickView = (v: CeremonyView) => {
    setView(v);
    handleRef.current?.setView(v);
  };

  const header = (
    <div className="mx-auto max-w-7xl px-5 pb-14 md:px-8">
      <p className="lp-eyebrow lp-accent">The venue, explorable</p>
      <h2 className="lp-display mt-6 text-[clamp(2.2rem,5.4vw,4.8rem)] text-foreground">
        Fly the approach. Then <em className="lp-accent">stand</em> where
        they'll stand.
      </h2>
      <p className="mt-6 max-w-xl leading-relaxed text-foreground/70">
        {reduce
          ? "The ceremony at the threshold — change the view, then re-light the whole evening."
          : "Scroll to descend from the ridge to the altar. At the threshold, look around and re-light the whole evening. This is the feeling glimpse delivers to their phone."}
      </p>
    </div>
  );

  if (reduce) {
    return (
      <section id="ceremony" className="py-28 md:py-40">
        {header}
        <div className="mx-auto max-w-7xl px-5 md:px-8">
          <div
            ref={wrapRef as React.RefObject<HTMLDivElement>}
            className="relative h-[62vh] min-h-[26rem] overflow-hidden rounded-3xl border border-white/10 bg-black/30"
          >
            <canvas
              ref={canvasRef}
              className={cn("absolute inset-0 h-full w-full", ready ? "opacity-100" : "opacity-0")}
              aria-label="3D preview of a ceremony set up at a mountain venue"
              role="img"
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-4 p-4 md:p-6">
              <ViewPills view={view} onView={pickView} />
              <MoodDial mood={mood} onMood={onMood} compact />
            </div>
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
          {/* The live ceremony crossfades in over the page-background
              footage as the flight reaches the threshold. */}
          <motion.div className="absolute inset-0" style={{ opacity: canvasOpacity }}>
            <canvas
              ref={canvasRef}
              className={cn(
                "h-full w-full transition-opacity duration-1000",
                ready ? "opacity-100" : "opacity-0",
              )}
              aria-label="Interactive 3D flight into a ceremony at a mountain venue"
              role="img"
            />
          </motion.div>

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

          {/* Pre-arrival scroll hint */}
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

          {/* Arrival controls */}
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-end justify-between gap-4 p-4 transition-opacity duration-700 md:p-8",
              arrived ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <ViewPills view={view} onView={pickView} />
            <p className="hidden text-[12px] text-foreground/45 lg:block">Drag to look around</p>
            <MoodDial mood={mood} onMood={onMood} compact />
          </div>
        </div>
      </section>
    </section>
  );
}
