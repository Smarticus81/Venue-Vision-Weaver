import { cn } from "@/lib/utils";

/* Legitimacy verdict as a pill: text + dot, so the state never relies on colour alone. */

const TONE: Record<string, string> = {
  unvetted: "text-muted-foreground",
  passed: "text-success",
  review: "text-warning",
  failed: "text-danger",
  error: "text-danger",
};

export function vettingLabel(status: string, score: number | null | undefined): string {
  switch (status) {
    case "passed":
      return score != null ? `vetted ${score}` : "vetted";
    case "review":
      return score != null ? `review ${score}` : "review";
    case "failed":
      return score != null ? `failed ${score}` : "failed";
    case "error":
      return "vetting error";
    default:
      return "unvetted";
  }
}

export function VettingBadge({
  status,
  score,
  className,
}: {
  status: string;
  score: number | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn("mono-label inline-flex items-center gap-1.5", TONE[status] ?? "text-muted-foreground", className)}
      title={status === "passed" ? "Legitimacy checks passed" : status === "unvetted" ? "Legitimacy checks have not run" : undefined}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full border border-current bg-current opacity-70" />
      {vettingLabel(status, score)}
    </span>
  );
}
