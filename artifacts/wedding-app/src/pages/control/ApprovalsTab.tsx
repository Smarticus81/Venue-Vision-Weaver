import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetControlOverviewQueryKey,
  useListControlActions,
  getListControlActionsQueryKey,
  useDecideControlAction,
  type ControlAction,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

/* ————— Approvals ————— */

function ActionRow({ action }: { action: ControlAction }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useDecideControlAction({
    mutation: {
      onSuccess: (data) => {
        toast({
          title:
            data.action.status === "executed"
              ? `Action #${data.action.id} approved and executed`
              : `Action #${data.action.id} ${data.action.status}`,
          description: data.action.error ?? undefined,
          variant: data.action.status === "failed" ? "destructive" : undefined,
        });
        void queryClient.invalidateQueries({ queryKey: getListControlActionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Decision failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });

  const pending = action.status === "pending";
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Pill value={action.status} />
          <Pill value={action.riskLevel} />
          <span className="mono-label text-muted-foreground">
            {action.agentKey} · #{action.id} · {fmt(action.createdAt)}
          </span>
        </div>
        <span className="mono-label text-foreground/60">{action.actionType}</span>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{action.title}</p>
      {action.reasoning ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{action.reasoning}</p>
      ) : null}
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-xs text-foreground/80">
        {JSON.stringify(action.params, null, 2)}
      </pre>
      {action.result ? (
        <pre className="mt-2 overflow-x-auto rounded-md border border-success/30 bg-success-soft p-3 text-xs text-success">
          {JSON.stringify(action.result, null, 2)}
        </pre>
      ) : null}
      {action.error ? <p className="mt-2 text-xs text-danger">{action.error}</p> : null}
      {action.decidedBy ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Decided by {action.decidedBy} at {fmt(action.decidedAt)}
          {action.decisionNote ? ` — ${action.decisionNote}` : ""}
        </p>
      ) : null}
      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision note (optional)"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <ActionButton
            tone="primary"
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({ id: action.id, data: { decision: "approve", note: note || undefined } })
            }
          >
            {decide.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Approve and execute
          </ActionButton>
          <ActionButton
            tone="danger"
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({ id: action.id, data: { decision: "reject", note: note || undefined } })
            }
          >
            Reject
          </ActionButton>
        </div>
      ) : null}
    </Card>
  );
}

export function ApprovalsTab() {
  const actionsQuery = useListControlActions(
    {},
    { query: { queryKey: getListControlActionsQueryKey(), refetchInterval: 20000 } },
  );
  const actions = actionsQuery.data?.actions ?? [];
  const pending = actions.filter((a) => a.status === "pending");
  const decided = actions.filter((a) => a.status !== "pending");

  if (actionsQuery.isLoading) return <TabLoading />;
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Awaiting approval ({pending.length})</h2>
        {pending.length === 0 ? (
          <EmptyState text="No actions waiting for approval. Agents will queue governed side effects here." />
        ) : (
          pending.map((action) => <ActionRow key={action.id} action={action} />)
        )}
      </section>
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">History</h2>
        {decided.length === 0 ? (
          <EmptyState text="No decided actions yet." />
        ) : (
          decided.map((action) => <ActionRow key={action.id} action={action} />)
        )}
      </section>
    </div>
  );
}
