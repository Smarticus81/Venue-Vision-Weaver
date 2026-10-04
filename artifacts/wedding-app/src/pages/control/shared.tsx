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
  active: "text-emerald-300",
  succeeded: "text-emerald-300",
  executed: "text-emerald-300",
  approved: "text-emerald-300",
  done: "text-emerald-300",
  completed: "text-emerald-300",
  sent: "text-emerald-300",
  delivered: "text-emerald-300",
  running: "text-rose",
  in_progress: "text-rose",
  pending: "text-amber-300",
  proposed: "text-amber-300",
  open: "text-amber-300",
  paused: "text-muted-foreground",
  dismissed: "text-muted-foreground",
  rejected: "text-muted-foreground",
  aborted: "text-muted-foreground",
  failed: "text-red-300",
  bounced: "text-red-300",
  complained: "text-red-300",
  critical: "text-red-300",
  high: "text-amber-300",
  medium: "text-foreground/70",
  low: "text-muted-foreground",
  new: "text-amber-300",
  qualified: "text-emerald-300",
  contacted: "text-rose",
  replied: "text-emerald-300",
  converted: "text-emerald-300",
  unsubscribed: "text-muted-foreground",
  disqualified: "text-muted-foreground",
  draft: "text-amber-300",
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
    <div className={cn("border border-border bg-card p-5", className)}>{children}</div>
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
        "inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "bg-rose text-rose-foreground hover:bg-rose-hover",
        tone === "neutral" &&
          "border border-border text-foreground/80 hover:border-foreground/40 hover:text-foreground",
        tone === "danger" && "border border-red-400/40 text-red-300 hover:border-red-400/70",
      )}
    >
      {children}
    </button>
  );
}

export function TabLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-rose" />
    </div>
  );
}
