import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * The page background IS the flight footage: a fixed, full-viewport,
 * object-cover video scrubbed by overall page scroll. The film opens on
 * the night sky above the ridge (hero), descends through the landscape
 * as the visitor scrolls, and reaches the candlelit altar as the
 * descent track ends — then holds that final frame beneath the
 * remaining sections. No gradients, no texture layers, no heavy scrims:
 * the footage carries the page.
 *
 * The scrub maps video time over [page top → 90% through the
 * #descent-track element], matching the point where the live WebGL
 * ceremony crossfades in above it.
 */
export function FlightBackdrop() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reduce = useReducedMotion() ?? false;

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let cur = 0;
    const tick = () => {
      const vid = videoRef.current;
      if (vid && Number.isFinite(vid.duration) && vid.duration > 0) {
        const track = document.getElementById("descent-track");
        let target = 0;
        if (track) {
          const rect = track.getBoundingClientRect();
          const trackTop = rect.top + window.scrollY;
          const span = Math.max(1, track.offsetHeight - window.innerHeight);
          const endScroll = trackTop + span * 0.9;
          target = Math.min(1, Math.max(0, window.scrollY / Math.max(1, endScroll)));
        }
        cur += (target - cur) * 0.14;
        const t = cur * Math.max(0, vid.duration - 0.06);
        if (Math.abs(vid.currentTime - t) > 1 / 30 && vid.readyState >= 2) {
          vid.currentTime = t;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  if (reduce) {
    // Static: the real opening frame at full quality, no motion.
    return (
      <img
        src="/brand/descent-flight-poster.webp"
        alt=""
        aria-hidden
        className="fixed inset-0 z-0 h-full w-full object-cover"
      />
    );
  }

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      preload="auto"
      poster="/brand/descent-flight-poster.webp"
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-full w-full object-cover"
    >
      <source src="/brand/descent-flight.webm" type="video/webm" />
      <source src="/brand/descent-flight.mp4" type="video/mp4" />
    </video>
  );
}
