import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type {
  ControlPlaneObservation,
  ControlPlaneRiskLevel,
  ControlPlaneSeverity,
} from "@workspace/api-client-react";

/**
 * The console's shared vocabulary. The operator reads these tiles all day, so
 * severity, risk, and delta always look the same wherever they appear.
 */

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glimpse-card p-5 sm:p-6", className)}>
      {(title || eyebrow || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && <p className="mono-label mb-1.5 text-rose">{eyebrow}</p>}
            {title && <h2 className="font-display text-lg font-medium leading-tight">{title}</h2>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

const SEVERITY_STYLE: Record<ControlPlaneSeverity, { dot: string; text: string; label: string }> = {
  info: { dot: "bg-emerald-400", text: "text-emerald-300", label: "Nominal" },
  warning: { dot: "bg-amber-400", text: "text-amber-300", label: "Attention" },
  critical: { dot: "bg-red-400 animate-pulse", text: "text-red-300", label: "Critical" },
};

export function SeverityPill({
  severity,
  label,
  className,
}: {
  severity: ControlPlaneSeverity;
  label?: string;
  className?: string;
}) {
  const style = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info;
  return (
    <span className={cn("mono-label inline-flex items-center gap-1.5", style.text, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
      {label ?? style.label}
    </span>
  );
}

const RISK_STYLE: Record<ControlPlaneRiskLevel, string> = {
  low: "border-emerald-400/30 text-emerald-300",
  medium: "border-amber-400/30 text-amber-300",
  high: "border-red-400/40 text-red-300",
};

export function RiskBadge({ risk }: { risk: ControlPlaneRiskLevel }) {
  return (
    <span
      className={cn(
        "mono-label rounded-full border px-2 py-0.5 leading-none",
        RISK_STYLE[risk] ?? RISK_STYLE.low,
      )}
    >
      {risk} risk
    </span>
  );
}

/**
 * A measurement with its direction of travel. Colour follows whether the
 * change is good, never whether the number went up.
 */
export function Stat({
  label,
  value,
  detail,
  delta,
  goodDirection,
  severity,
}: {
  label: string;
  value: ReactNode;
  detail?: string | null;
  delta?: number | null;
  goodDirection?: "up" | "down" | "neutral";
  severity?: ControlPlaneSeverity;
}) {
  const good =
    delta === null || delta === undefined || goodDirection === "neutral" || !goodDirection
      ? null
      : goodDirection === "up"
        ? delta >= 0
        : delta <= 0;

  return (
    <div className="min-w-0">
      <p className="mono-label mb-1.5 text-muted-foreground">{label}</p>
      <p className="mono-figure text-2xl leading-none text-foreground">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {delta !== null && delta !== undefined && (
          <span
            className={cn(
              "mono-label",
              good === null ? "text-muted-foreground" : good ? "text-emerald-300" : "text-red-300",
            )}
          >
            {delta >= 0 ? "+" : ""}
            {Math.round(delta * 1000) / 10}%
          </span>
        )}
        {severity && severity !== "info" && <SeverityPill severity={severity} />}
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </div>
    </div>
  );
}

export function ObservationStat({ observation }: { observation: ControlPlaneObservation }) {
  return (
    <Stat
      label={observation.label}
      value={observation.value === null || observation.value === undefined ? "—" : observation.value}
      detail={observation.detail}
      delta={observation.delta}
      goodDirection={observation.goodDirection}
      severity={observation.severity}
    />
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatNumber(value: number | null | undefined, places = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

export function formatPercentValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}
