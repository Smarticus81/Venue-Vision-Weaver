import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { MoodKey } from "./moods";
import type { CeremonySceneHandle, CeremonyView } from "./ceremonyScene";

const VIEW_LABELS: Record<CeremonyView, string> = {
  aisle: "Aisle",
  altar: "Altar",
  aerial: "Aerial",
};

/**
 * The explorable 3D ceremony panel. The scene module (three.js) is
 * imported only when the panel approaches the viewport, and the render
 * loop pauses whenever it scrolls away.
 */
export function CeremonyCanvas({ mood }: { mood: MoodKey }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<CeremonySceneHandle | null>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const reduce = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<CeremonyView>("aisle");

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let cancelled = false;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !handleRef.current) {
          import("./ceremonyScene").then(({ createCeremonyScene }) => {
            if (cancelled || handleRef.current) return;
            const handle = createCeremonyScene(canvas, {
              mood: moodRef.current,
              reducedMotion: reduce,
            });
            if (!handle) return;
            handleRef.current = handle;
            setReady(true);
          });
        }
        handleRef.current?.setActive(entry.isIntersecting);
      },
      { rootMargin: "260px" },
    );
    io.observe(wrap);

    return () => {
      cancelled = true;
      io.disconnect();
      handleRef.current?.destroy();
      handleRef.current = null;
      setReady(false);
    };
  }, [reduce]);

  useEffect(() => {
    handleRef.current?.setMood(mood);
  }, [mood, ready]);

  const pick = (v: CeremonyView) => {
    setView(v);
    handleRef.current?.setView(v);
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-[62vh] min-h-[26rem] overflow-hidden rounded-3xl border border-white/10 bg-black/30 md:h-[72vh]"
    >
      <canvas
        ref={canvasRef}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-1000",
          ready ? "opacity-100" : "opacity-0",
        )}
        aria-label="Interactive 3D preview of a ceremony set up at a mountain venue"
        role="img"
      />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="lp-eyebrow text-foreground/40">Setting the ceremony…</p>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-4 md:p-6">
        <div
          role="group"
          aria-label="Camera view"
          className="pointer-events-auto inline-flex rounded-full border border-white/10 bg-black/45 p-1 backdrop-blur-md"
        >
          {(Object.keys(VIEW_LABELS) as CeremonyView[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => pick(v)}
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

        <p className="hidden text-[12px] text-foreground/45 md:block">
          Drag to look around
        </p>
      </div>
    </div>
  );
}
