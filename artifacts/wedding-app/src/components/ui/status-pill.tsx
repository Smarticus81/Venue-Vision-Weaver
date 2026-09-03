import { cn } from "@/lib/utils";

type SessionStatus = "pending" | "processing" | "ready" | "failed" | (string & {});

const STATUS: Record<string, { label: string; dot: string; text: string }> = {
  ready: { label: "Ready", dot: "bg-emerald-400", text: "text-emerald-300" },
  processing: { label: "Developing", dot: "bg-rose animate-pulse", text: "text-rose" },
  pending: { label: "Queued", dot: "bg-rose/70", text: "text-rose/90" },
  failed: { label: "Failed", dot: "bg-red-400", text: "text-red-300" },
};

/** One vocabulary for gallery state, everywhere it appears. */
export function StatusPill({ status, className }: { status: SessionStatus; className?: string }) {
  const s = STATUS[status] ?? { label: status, dot: "bg-muted-foreground", text: "text-muted-foreground" };
  return (
    <span className={cn("mono-label inline-flex items-center gap-1.5", s.text, className)}>
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function statusLabel(status: SessionStatus): string {
  return STATUS[status]?.label ?? status;
}
