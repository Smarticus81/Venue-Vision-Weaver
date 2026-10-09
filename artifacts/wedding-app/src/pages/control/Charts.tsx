import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { barWidth, byUnit, day, delta, nearestIndex, pct, share, sparkGeometry, type TrendUnit } from "./format";

/*
 * Console charts, all inline SVG/CSS on design tokens (no chart library).
 * One data hue (the brand secondary teal) for marks, muted ink for context,
 * text tokens for every number. Deltas carry a glyph so direction never
 * depends on colour alone; every chart has a text/table equivalent.
 */

export interface TrendPoint {
  at: string;
  value: number;
}

const SPARK_W = 160;
const SPARK_H = 40;

/**
 * Sparkline with a snapping crosshair: the pointer (or arrow keys when
 * focused) picks the nearest day and a readout shows its date and value.
 * The line is recessive (muted); the current point wears the data hue.
 */
export function Sparkline({ points, unit, label }: { points: TrendPoint[]; unit: TrendUnit; label: string }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const values = useMemo(() => points.map((p) => p.value), [points]);
  const geometry = useMemo(() => sparkGeometry(values, SPARK_W, SPARK_H, 4), [values]);

  if (points.length < 2) {
    return <p className="mono-label h-10 pt-3 text-muted-foreground">Trend after two snapshots</p>;
  }
  const last = geometry.points[geometry.points.length - 1]!;
  const shown = active ?? points.length - 1;
  const shownPoint = geometry.points[shown]!;

  const pick = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / Math.max(1, rect.width)) * SPARK_W;
    setActive(nearestIndex(geometry.points.map((p) => p.x), x));
  };

  return (
    <div className="relative space-y-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="block h-10 w-full touch-none overflow-visible text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        role="img"
        tabIndex={0}
        aria-label={`${label}: ${points.length} daily values from ${day(points[0]!.at)} (${byUnit(points[0]!.value, unit)}) to ${day(points[points.length - 1]!.at)} (${byUnit(points[points.length - 1]!.value, unit)})`}
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? points.length - 1) - 1));
          if (e.key === "ArrowRight") setActive((i) => Math.min(points.length - 1, (i ?? points.length - 1) + 1));
        }}
      >
        <path d={geometry.path} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      {/* Hairline and dots are HTML so they stay round while the SVG stretches. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-10">
        {active !== null ? (
          <span className="absolute inset-y-0 w-px bg-border" style={{ left: `${(shownPoint.x / SPARK_W) * 100}%` }} />
        ) : null}
        <Dot x={last.x} y={last.y} className="bg-secondary" />
        {active !== null && active !== points.length - 1 ? (
          <Dot x={shownPoint.x} y={shownPoint.y} className="bg-foreground" />
        ) : null}
      </div>
      <p className="mono-label flex justify-between gap-2 text-muted-foreground" aria-live="polite">
        <span>{active === null ? `${day(points[0]!.at)} – today` : day(points[shown]!.at)}</span>
        {active !== null ? <span className="text-foreground">{byUnit(points[shown]!.value, unit)}</span> : null}
      </p>
    </div>
  );
}

function Dot({ x, y, className }: { x: number; y: number; className: string }) {
  return (
    <span
      className={cn("absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", className)}
      style={{ left: `${(x / SPARK_W) * 100}%`, top: `${(y / SPARK_H) * 100}%` }}
    />
  );
}

export function DeltaBadge({
  change,
  unit,
  betterWhen,
  period = "vs 7 days ago",
}: {
  change: number | null | undefined;
  unit: TrendUnit;
  betterWhen: "higher" | "lower";
  period?: string;
}) {
  const view = delta(change, unit, betterWhen);
  if (!view) return <span className="text-xs text-muted-foreground">no 7-day history yet</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        view.tone === "good" ? "text-success" : view.tone === "bad" ? "text-danger" : "text-muted-foreground",
      )}
    >
      <span aria-hidden className="text-[9px]">{view.glyph}</span>
      <span>{view.text}</span>
      <span className="text-muted-foreground">{period}</span>
    </span>
  );
}

/** Stat tile: label, value, optional sub line, 7-day delta and sparkline. */
export function StatTile({
  label,
  value,
  sub,
  points,
  unit,
  change,
  betterWhen = "higher",
}: {
  label: string;
  value: string;
  sub?: string;
  points?: TrendPoint[];
  unit: TrendUnit;
  change?: number | null;
  betterWhen?: "higher" | "lower";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="font-display text-2xl font-semibold text-foreground sm:text-3xl">{value}</p>
      <DeltaBadge change={change} unit={unit} betterWhen={betterWhen} />
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
      {points ? <Sparkline points={points} unit={unit} label={label} /> : null}
    </div>
  );
}

export interface FunnelStage {
  label: string;
  value: number;
  /** Override the "of previous" basis (e.g. churned is a share of paid). */
  basisLabel?: string;
  basis?: number;
}

/**
 * A funnel as horizontal bars on one data hue. Widths are relative to the
 * first stage; each row names its count and its conversion from the stage
 * before (with the denominator), so the chart reads without hovering.
 */
export function FunnelBars({ title, stages, caption }: { title: string; stages: FunnelStage[]; caption?: string }) {
  const headingId = useId();
  const max = stages[0]?.value ?? 0;
  return (
    <figure className="space-y-2" aria-labelledby={headingId}>
      <figcaption id={headingId} className="mono-label text-muted-foreground">
        {title}
      </figcaption>
      <ol className="space-y-1.5">
        {stages.map((stage, index) => {
          const previous = index === 0 ? null : stages[index - 1]!;
          const basis = stage.basis ?? previous?.value ?? null;
          const conversion = basis !== null ? share(stage.value, basis) : null;
          const basisLabel = stage.basisLabel ?? previous?.label.toLowerCase();
          const tip =
            basis !== null
              ? `${stage.label}: ${stage.value} (${pct(conversion, 0)} of ${basis} ${basisLabel ?? ""})`
              : `${stage.label}: ${stage.value}`;
          return (
            <li key={stage.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)_9rem]" title={tip}>
              <span className="truncate text-xs text-foreground/80">{stage.label}</span>
              <span className="relative h-5 rounded-[4px] bg-muted" aria-hidden>
                <span
                  className="absolute inset-y-0 left-0 rounded-[4px] bg-secondary"
                  style={{ width: `${barWidth(stage.value, max)}%` }}
                />
              </span>
              <span className="text-right text-xs tabular-nums text-foreground">
                {stage.value.toLocaleString("en-US")}
                {basis !== null ? (
                  <span className="ml-1.5 text-muted-foreground">
                    {pct(conversion, 0)}
                    <span className="hidden sm:inline"> of {basisLabel}</span>
                  </span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
    </figure>
  );
}

/** Table view of trend series: the accessible equivalent of the sparklines. */
export function TrendTable({
  series,
}: {
  series: Array<{ key: string; label: string; unit: TrendUnit; points: TrendPoint[] }>;
}) {
  const days = useMemo(() => {
    const all = new Set<string>();
    for (const s of series) for (const p of s.points) all.add(p.at.slice(0, 10));
    return [...all].sort().reverse();
  }, [series]);
  if (days.length === 0) return <p className="text-xs text-muted-foreground">No snapshots yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-1.5 pr-3 font-normal">Day</th>
            {series.map((s) => (
              <th key={s.key} className="py-1.5 pr-3 font-normal">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {days.map((d) => (
            <tr key={d} className="border-b border-border/60">
              <td className="py-1 pr-3 text-muted-foreground">{day(`${d}T12:00:00Z`)}</td>
              {series.map((s) => {
                const point = [...s.points].reverse().find((p) => p.at.slice(0, 10) === d);
                return (
                  <td key={s.key} className="py-1 pr-3 text-foreground">
                    {point ? byUnit(point.value, s.unit) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
