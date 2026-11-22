import { useEffect, useRef } from "react";
import type { LensController } from "@/lib/lensRenderer";

export function PossibilityLens({ vision, paused }: { vision: boolean; paused: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<LensController | null>(null);
  const state = useRef({ vision, paused });
  state.current = { vision, paused };
  useEffect(() => {
    let cancelled = false;
    void import("@/lib/lensRenderer").then(async ({ mountLens }) => {
      if (!canvas.current || cancelled) return;
      const controller = await mountLens(canvas.current);
      if (cancelled) { controller?.destroy(); return; }
      renderer.current = controller;
      controller?.setVision(state.current.vision); controller?.setPaused(state.current.paused);
    }).catch(() => { /* Keep the ordinary image when the optional chunk cannot load. */ });
    return () => { cancelled = true; renderer.current?.destroy(); renderer.current = null; };
  }, []);
  useEffect(() => { renderer.current?.setVision(vision); renderer.current?.setPaused(paused); }, [vision, paused]);
  return <canvas ref={canvas} className="lens-refraction" aria-hidden="true"/>;
}
