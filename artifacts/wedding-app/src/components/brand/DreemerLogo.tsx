import type { JSX } from "react";
import { Link } from "wouter";
import {
  ICON_BODY_PATH,
  ICON_LINE_PATHS,
  ICON_LINE_STROKE,
  ICON_SIZE,
  ICON_SPARK_PATHS,
  ICON_SPARK_STROKE,
  LOCKUP_GAP,
  LOCKUP_ICON_OFFSET_Y,
  LOCKUP_ICON_SCALE,
  LOCKUP_ICON_WIDTH,
  LOCKUP_WIDTH,
  WORDMARK_HEIGHT,
  WORDMARK_PATHS,
  WORDMARK_STROKE,
  WORDMARK_WIDTH,
} from "@workspace/brand";
import { cn } from "@/lib/utils";

type DreemerLogoProps = {
  /** `lockup` = mark + wordmark (default), `mark` = icon only, `wordmark` = text only. */
  variant?: "lockup" | "mark" | "wordmark";
  /** `color` paints the mark coral and the wordmark in the current text color; `mono` uses currentColor for everything. */
  tone?: "color" | "mono";
  className?: string;
  /** Pass `null` to render without a link. */
  href?: string | null;
};

/**
 * The Dreemer logo, drawn from the same geometry as the files in
 * lib/brand/assets/logo so the app can never drift from the asset set. The
 * wordmark is paths, not text, so it does not wait on a web font.
 */
export function DreemerLogo({
  variant = "lockup",
  tone = "color",
  className,
  href = "/",
}: DreemerLogoProps) {
  const markFill = tone === "color" ? "var(--dm-accent)" : "currentColor";
  const mark = (
    <g>
      <path d={ICON_BODY_PATH} fill={markFill} />
      <g fill="none" stroke={markFill} strokeWidth={ICON_LINE_STROKE} strokeLinecap="round">
        {ICON_LINE_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill="none" stroke={markFill} strokeWidth={ICON_SPARK_STROKE} strokeLinecap="round">
        {ICON_SPARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </g>
  );
  const word = (
    <g fill="none" stroke="currentColor" strokeWidth={WORDMARK_STROKE} strokeLinejoin="round">
      {WORDMARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </g>
  );

  let svg: JSX.Element;
  if (variant === "mark") {
    svg = (
      <svg viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`} className="h-[1.15em] w-auto" aria-hidden focusable="false">
        {mark}
      </svg>
    );
  } else if (variant === "wordmark") {
    svg = (
      <svg viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`} className="h-[1em] w-auto" aria-hidden focusable="false">
        {word}
      </svg>
    );
  } else {
    svg = (
      <svg viewBox={`0 0 ${LOCKUP_WIDTH} ${WORDMARK_HEIGHT}`} className="h-[1em] w-auto" aria-hidden focusable="false">
        <g transform={`translate(0 ${LOCKUP_ICON_OFFSET_Y}) scale(${LOCKUP_ICON_SCALE})`}>{mark}</g>
        <g transform={`translate(${LOCKUP_ICON_WIDTH + LOCKUP_GAP} 0)`}>{word}</g>
      </svg>
    );
  }

  const logo = (
    <span className={cn("inline-flex items-center text-[1.5rem] leading-none text-foreground select-none", className)}>
      {svg}
      <span className="sr-only">Dreemer</span>
    </span>
  );

  if (!href) return logo;
  return (
    <Link
      href={href}
      aria-label="Dreemer home"
      className="inline-flex min-h-11 items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {logo}
    </Link>
  );
}
