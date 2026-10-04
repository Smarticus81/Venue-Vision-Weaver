import type { ErrorEnvelope } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* Shared bits for the control console tabs. */

export function fmt(dateish: string | null | undefined): string {
  if (!dateish) return "—";
  const date = new Date(dateish);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function apiErrorMessage(err: unknown): string {
  const data = (err as { data?: ErrorEnvelope })?.data;
  if (data?.error) return data.error;
  return err instanceof Error ? err.message : "Request failed";
}

const PILL: Record<string, string> = {
  active: "text-success",
  succeeded: "text-success",
  executed: "text-success",
  approved: "text-success",
  done: "text-success",
  completed: "text-success",
  sent: "text-success",
  delivered: "text-success",
  running: "text-brand",
  in_progress: "text-brand",
  pending: "text-warning",
  proposed: "text-warning",
  open: "text-warning",
  paused: "text-muted-foreground",
  dismissed: "text-muted-foreground",
  rejected: "text-muted-foreground",
  aborted: "text-muted-foreground",
  failed: "text-danger",
  bounced: "text-danger",
  complained: "text-danger",
  critical: "text-danger",
  high: "text-warning",
  medium: "text-foreground/70",
  low: "text-muted-foreground",
  new: "text-warning",
  qualified: "text-success",
  contacted: "text-brand",
  replied: "text-success",
  converted: "text-success",
  unsubscribed: "text-muted-foreground",
  disqualified: "text-muted-foreground",
  draft: "text-warning",
};

export function Pill({ value, className }: { value: string; className?: string }) {
  return (
    <span
      className={cn(
        "mono-label inline-flex items-center gap-1.5",
        PILL[value] ?? "text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-5", className)}>{children}</div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <Card className="text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}

export function ActionButton({
  onClick,
  disabled,
  tone = "neutral",
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "neutral" | "danger";
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-primary text-primary-foreground hover:bg-brand-hover",
        tone === "neutral" &&
          "border border-border bg-background text-foreground hover:bg-soft",
        tone === "danger" && "border border-danger/40 text-danger hover:bg-danger-soft",
      )}
    >
      {children}
    </button>
  );
}

export function TabLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-brand" />
    </div>
  );
}
