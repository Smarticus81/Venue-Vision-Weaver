import { useEffect, useRef, useState } from "react";
import { useReducedMotion, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import type { MoodKey } from "./moods";
import type { VenueSceneHandle } from "./venueScene";

/**
 * Fixed, full-viewport WebGL layer. three.js is imported dynamically so
 * nothing above the fold waits on it; until (or unless) it arrives, the
 * CSS .lp-sky gradient behind this canvas is the whole picture.
 */
export function SceneCanvas({
  mood,
  progress,
}: {
  mood: MoodKey;
  progress: MotionValue<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<VenueSceneHandle | null>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const reduce = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    import("./venueScene").then(({ createVenueScene }) => {
      if (cancelled) return;
      const handle = createVenueScene(canvas, {
        mood: moodRef.current,
        reducedMotion: reduce,
      });
      if (!handle) return; // no WebGL — the CSS sky carries the page
      handleRef.current = handle;
      handle.setScroll(progress.get());
      setReady(true);
    });

    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
      setReady(false);
    };
    // progress is a stable MotionValue ref from useScroll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  useEffect(() => {
    handleRef.current?.setMood(mood);
  }, [mood, ready]);

  useEffect(() => {
    const unsub = progress.on("change", (v) => handleRef.current?.setScroll(v));
    return unsub;
  }, [progress, ready]);

  useEffect(() => {
    if (reduce || !window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (e: PointerEvent) => {
      handleRef.current?.setPointer(
        (e.clientX / window.innerWidth) * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduce, ready]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        "fixed inset-0 h-full w-full transition-opacity duration-1000",
        ready ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
