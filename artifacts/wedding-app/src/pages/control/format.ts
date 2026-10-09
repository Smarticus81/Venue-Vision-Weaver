/*
 * Number formatting for the operator console. Every helper returns "—" for
 * null/undefined/NaN so a missing KPI never renders as 0. Pure functions;
 * unit-tested in format.test.ts.
 */

const DASH = "—";

function isNum(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Fraction 0..1 -> "4.2%". */
export function pct(x: number | null | undefined, digits = 1): string {
  if (!isNum(x)) return DASH;
  return `${(x * 100).toFixed(digits)}%`;
}

/** Already a percentage (0..100) -> "58%". */
export function pctPoints(x: number | null | undefined, digits = 0): string {
  if (!isNum(x)) return DASH;
  return `${x.toFixed(digits)}%`;
}

/** Cents -> "$1,290" (whole dollars; cents shown only under $100). */
export function money(cents: number | null | undefined): string {
  if (!isNum(cents)) return DASH;
  const dollars = cents / 100;
  const digits = Math.abs(dollars) < 100 && Math.round(dollars) !== dollars ? 2 : 0;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Hours -> "5.3 h", or days over 48 h -> "2.1 d". */
export function hours(h: number | null | undefined): string {
  if (!isNum(h)) return DASH;
  if (h > 48) return `${(h / 24).toFixed(1)} d`;
  return `${h.toFixed(1)} h`;
}

/** Integer with grouping; compacts at 10k+ ("12.9K"). */
export function count(n: number | null | undefined): string {
  if (!isNum(n)) return DASH;
  if (Math.abs(n) >= 10_000) {
    return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }
  return Math.round(n).toLocaleString("en-US");
}

/** "3/41" — a rate always travels with its denominator. */
export function ratio(part: number | null | undefined, whole: number | null | undefined): string {
  if (!isNum(part) || !isNum(whole)) return DASH;
  return `${count(part)}/${count(whole)}`;
}

/** part/whole as a fraction, null when the denominator is 0. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export type TrendUnit = "count" | "percent" | "cents" | "rate";

/** Format a value by its trend unit. */
export function byUnit(value: number | null | undefined, unit: TrendUnit): string {
  switch (unit) {
    case "cents":
      return money(value);
    case "percent":
      return pctPoints(value, 0);
    case "rate":
      return pct(value, 2);
    default:
      return count(value);
  }
}

export interface DeltaView {
  /** Signed text, e.g. "+2", "−$129", "+1.5 pts". */
  text: string;
  /** Arrow glyph so direction never relies on colour alone. */
  glyph: "▲" | "▼" | "■";
  tone: "good" | "bad" | "flat";
}

/**
 * Describe a change. `betterWhen` decides whether up is good news. Rates and
 * percentages are shown as point changes (not relative %), so a move from
 * 1% to 2% reads "+1.00 pts", never "+100%".
 */
export function delta(
  change: number | null | undefined,
  unit: TrendUnit,
  betterWhen: "higher" | "lower" = "higher",
): DeltaView | null {
  if (!isNum(change)) return null;
  const epsilon = unit === "rate" ? 1e-6 : 1e-9;
  if (Math.abs(change) < epsilon) return { text: "no change", glyph: "■", tone: "flat" };
  const up = change > 0;
  const sign = up ? "+" : "−";
  const magnitude = Math.abs(change);
  const text =
    unit === "cents"
      ? `${sign}${money(magnitude)}`
      : unit === "percent"
        ? `${sign}${magnitude.toFixed(1)} pts`
        : unit === "rate"
          ? `${sign}${(magnitude * 100).toFixed(2)} pts`
          : `${sign}${count(magnitude)}`;
  const good = betterWhen === "higher" ? up : !up;
  return { text, glyph: up ? "▲" : "▼", tone: good ? "good" : "bad" };
}

/** Bar width in percent of the widest value, with a visible minimum for non-zero values. */
export function barWidth(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(2, Math.min(100, (value / max) * 100));
}

export interface SparkGeometry {
  path: string;
  points: Array<{ x: number; y: number }>;
}

/**
 * Map a series to SVG coordinates inside width x height with `pad` inset.
 * A flat series is drawn along the vertical middle. Fewer than one point
 * returns an empty path.
 */
export function sparkGeometry(values: number[], width: number, height: number, pad = 3): SparkGeometry {
  if (values.length === 0) return { path: "", points: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);
  const points = values.map((value, index) => ({
    x: pad + (values.length === 1 ? innerW : (index / (values.length - 1)) * innerW),
    y: span === 0 ? pad + innerH / 2 : pad + innerH - ((value - min) / span) * innerH,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return { path, points };
}

/** Index of the point whose x is nearest to `x` (crosshair snapping). */
export function nearestIndex(xs: number[], x: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  xs.forEach((value, index) => {
    const distance = Math.abs(value - x);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Short date "Oct 9". */
export function day(dateish: string | null | undefined): string {
  if (!dateish) return DASH;
  const date = new Date(dateish);
  if (Number.isNaN(date.getTime())) return DASH;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
