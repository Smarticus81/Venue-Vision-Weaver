import { useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import type { ControlPlaneDecision } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, RiskBadge, formatRelative } from "./primitives";

/**
 * The queue is the whole contract between the fleet and the operator: every
 * decision arrives with its reasoning, its evidence, and the exact effect it
 * will have if approved. Nothing executes from here that the operator cannot
 * read first.
 */
export function DecisionQueue({
  decisions,
  onApprove,
  onReject,
  busyId,
  emptyMessage,
}: {
  decisions: ControlPlaneDecision[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  busyId: number | null;
  emptyMessage?: string;
}) {
  if (!decisions.length) {
    return (
      <EmptyState>
        {emptyMessage ??
          "Nothing is waiting on you. The fleet is either within its guardrails or acting inside them."}
      </EmptyState>
    );
  }

  return (
    <ul className="space-y-3">
      {decisions.map((decision) => (
        <DecisionCard
          key={decision.id}
          decision={decision}
          onApprove={onApprove}
          onReject={onReject}
          busy={busyId === decision.id}
        />
      ))}
    </ul>
  );
}

function DecisionCard({
  decision,
  onApprove,
  onReject,
  busy,
}: {
  decision: ControlPlaneDecision;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const effect = decision.effect as { type?: string } | undefined;
  const actionable = decision.status === "proposed" || decision.status === "approved";

  return (
    <li
      className={cn(
        "rounded-lg border border-card-border bg-card p-4",
        decision.riskLevel === "high" && "border-red-400/25",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={decision.riskLevel} />
        <span className="mono-label text-muted-foreground">{decision.agentKey}</span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span className="mono-label text-muted-foreground">{formatRelative(decision.createdAt)}</span>
        {decision.status !== "proposed" && (
          <span className="mono-label ml-auto text-muted-foreground">{decision.status}</span>
        )}
      </div>

      <h3 className="mt-2 font-display text-base font-medium leading-snug">{decision.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{decision.rationale}</p>

      {decision.blockedReason && (
        <p className="mono-label mt-3 text-amber-300">Held: {decision.blockedReason}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="mono-figure">impact {Math.round(decision.impactScore)}</span>
        <span className="mono-figure">confidence {Math.round(decision.confidence * 100)}%</span>
        {effect?.type && <span className="mono-label">{effect.type}</span>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {actionable && (
          <>
            <Button size="sm" variant="rose" onClick={() => onApprove(decision.id)} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              Approve and run
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onReject(decision.id)} disabled={busy}>
              <X />
              Reject
            </Button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mono-label ml-auto inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:underline"
        >
          Evidence
          <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div>
            <p className="mono-label mb-1.5 text-muted-foreground">Effect if approved</p>
            <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-xs leading-relaxed text-foreground/80">
              {JSON.stringify(decision.effect, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mono-label mb-1.5 text-muted-foreground">Evidence</p>
            <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-xs leading-relaxed text-foreground/80">
              {JSON.stringify(decision.evidence, null, 2)}
            </pre>
          </div>
          {decision.executionResult && (
            <div>
              <p className="mono-label mb-1.5 text-muted-foreground">Result</p>
              <pre className="overflow-x-auto rounded-md bg-secondary p-3 text-xs leading-relaxed text-foreground/80">
                {JSON.stringify(decision.executionResult, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function DecisionQueuePanel({
  decisions,
  onApprove,
  onReject,
  busyId,
  action,
}: {
  decisions: ControlPlaneDecision[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  busyId: number | null;
  action?: React.ReactNode;
}) {
  return (
    <Panel
      eyebrow="Decision queue"
      title={
        decisions.length
          ? `${decisions.length} decision${decisions.length === 1 ? "" : "s"} waiting on you`
          : "Nothing waiting on you"
      }
      action={action}
    >
      <DecisionQueue
        decisions={decisions}
        onApprove={onApprove}
        onReject={onReject}
        busyId={busyId}
      />
    </Panel>
  );
}
