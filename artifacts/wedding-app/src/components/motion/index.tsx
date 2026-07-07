import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";

/** True on devices with a precise pointer (mouse/trackpad), false on touch. */
function useFinePointer() {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(pointer: fine)");
    const onChange = () => setFine(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return fine;
}

/**
 * Custom cursor: a rose dot with a lagging viewfinder ring. Desktop-only,
 * disabled for reduced motion. Elements can opt into a larger ring with
 * data-cursor="focus".
 */
export function DarkroomCursor() {
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const ringX = useSpring(x, { stiffness: 400, damping: 38, mass: 0.7 });
  const ringY = useSpring(y, { stiffness: 400, damping: 38, mass: 0.7 });
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    if (!fine || reduce) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const target = (e.target as HTMLElement | null)?.closest?.(
        "a, button, input, textarea, select, [data-cursor]",
      );
      setFocus(Boolean(target));
    };
    document.documentElement.classList.add("cursor-none");
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      document.documentElement.classList.remove("cursor-none");
      window.removeEventListener("pointermove", move);
    };
  }, [fine, reduce, x, y]);

  if (!fine || reduce) return null;

  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 z-[9999] h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose"
        style={{ x, y }}
      />
      <motion.div
        aria-hidden
        className={cn(
          "pointer-events-none fixed left-0 top-0 z-[9998] -translate-x-1/2 -translate-y-1/2 rounded-full border transition-[width,height,border-color] duration-200",
          focus ? "h-12 w-12 border-rose/70" : "h-7 w-7 border-foreground/30",
        )}
        style={{ x: ringX, y: ringY }}
      />
    </>
  );
}

/** Infinite marquee ribbon. Children are rendered twice for the loop. */
export function Marquee({
  children,
  className,
  speed = 26,
}: {
  children: ReactNode;
  className?: string;
  speed?: number;
}) {
  return (
    <div className={cn("marquee select-none", className)} aria-hidden>
      <div
        className="marquee-track"
        style={{ "--marquee-speed": `${speed}s` } as CSSProperties}
      >
        {children}
        {children}
      </div>
    </div>
  );
}

/**
 * Magnetic wrapper: the child drifts toward the pointer inside a radius and
 * springs home on leave. Desktop-only; renders children untouched elsewhere.
 */
export function Magnetic({
  children,
  strength = 0.35,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const fine = useFinePointer();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.5 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.5 });

  if (!fine || reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        x.set((e.clientX - (r.left + r.width / 2)) * strength);
        y.set((e.clientY - (r.top + r.height / 2)) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/** Viewfinder corner ticks around an absolutely-positioned parent. */
export function FrameTicks({ className, size = 18 }: { className?: string; size?: number }) {
  const tick = "absolute border-foreground/50";
  const s = `${size}px`;
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      <span className={cn(tick, "left-0 top-0 border-l border-t")} style={{ width: s, height: s }} />
      <span className={cn(tick, "right-0 top-0 border-r border-t")} style={{ width: s, height: s }} />
      <span className={cn(tick, "bottom-0 right-0 border-b border-r")} style={{ width: s, height: s }} />
      <span className={cn(tick, "bottom-0 left-0 border-b border-l")} style={{ width: s, height: s }} />
    </div>
  );
}

/** CSS-driven masked line reveal; visible instantly under reduced motion. */
export function RiseLines({
  lines,
  className,
  lineClassName,
  startDelay = 0,
  step = 110,
}: {
  lines: ReactNode[];
  className?: string;
  lineClassName?: string;
  startDelay?: number;
  step?: number;
}) {
  return (
    <span className={className}>
      {lines.map((line, i) => (
        <span key={i} className={cn("mask-line", lineClassName)}>
          <span style={{ "--rise-delay": `${startDelay + i * step}ms` } as CSSProperties}>
            {line}
          </span>
        </span>
      ))}
    </span>
  );
}
