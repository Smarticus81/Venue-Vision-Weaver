import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetControlOverviewQueryKey,
  useGetControlOverview,
  useListControlActions,
  getListControlActionsQueryKey,
  useDecideControlAction,
  type ControlAction,
  type ListControlActionsParams,
  type ListControlActionsStatus,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

/* ————— Approvals: server-side pending queue + paged history ————— */

const PAGE_SIZE = 25;
const RETIRED_NOTE = "retired: re-draft via studio";

function emailIdOf(action: ControlAction): number | null {
  const id = Number((action.params as Record<string, unknown>).emailId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function ActionParams({ action }: { action: ControlAction }) {
  const params = action.params as Record<string, unknown>;
  if (action.actionType === "send_venue_email") {
    return (
      <div className="mt-3 space-y-1.5 rounded-md border border-border bg-background/60 p-3 text-xs">
        <p className="text-muted-foreground">
          To the owners of <span className="font-mono text-foreground">{String(params.venueSlug ?? "?")}</span>
        </p>
        <p className="font-medium text-foreground">Subject: {String(params.subject ?? "")}</p>
        <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">{String(params.message ?? "")}</p>
      </div>
    );
  }
  if (action.actionType === "send_outreach_email") {
    const emailId = emailIdOf(action);
    return (
      <p className="mt-3 text-xs text-muted-foreground">
        Studio email #{emailId ?? "?"}. The rendered email, the venue's vetting and the facts it cites are in the Outreach tab.
      </p>
    );
  }
  return (
    <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-xs text-foreground/80">
      {JSON.stringify(params, null, 2)}
    </pre>
  );
}

function ActionRow({ action }: { action: ControlAction }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const retired = action.actionType === "send_prospect_email";
  const studio = action.actionType === "send_outreach_email";
  const [note, setNote] = useState(retired ? RETIRED_NOTE : "");
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
  const emailId = emailIdOf(action);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
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
      <ActionParams action={action} />
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
      {pending && retired ? (
        <p className="mt-3 text-xs text-danger">
          Retired legacy action: plain-text prospect emails bypass vetting and the studio. Reject this and use Pipeline → Draft email for the same prospect.
        </p>
      ) : null}
      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Decision note (optional)"
            aria-label="Decision note"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {studio ? (
            <a
              href={emailId ? `#outreach/${emailId}` : "#outreach"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              <ExternalLink className="h-3 w-3" />
              Review in Outreach
            </a>
          ) : (
            <ActionButton
              tone="primary"
              disabled={decide.isPending || retired}
              title={retired ? "Retired action; reject it" : undefined}
              onClick={() =>
                decide.mutate({ id: action.id, data: { decision: "approve", note: note || undefined } })
              }
            >
              {decide.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Approve and execute
            </ActionButton>
          )}
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

function Pager({
  offset,
  shown,
  total,
  onPage,
}: {
  offset: number;
  shown: number;
  total: number | null;
  onPage: (offset: number) => void;
}) {
  const hasNext = total !== null ? offset + shown < total : shown === PAGE_SIZE;
  if (offset === 0 && !hasNext) return null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="mono-label text-muted-foreground">
        {shown === 0 ? "none" : `${offset + 1}–${offset + shown}`}
        {total !== null ? ` of ${total}` : ""}
      </span>
      <div className="flex gap-1.5">
        <ActionButton tone="neutral" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE_SIZE))}>
          Previous
        </ActionButton>
        <ActionButton tone="neutral" disabled={!hasNext} onClick={() => onPage(offset + PAGE_SIZE)}>
          Next
        </ActionButton>
      </div>
    </div>
  );
}

const HISTORY_FILTERS = ["all", "executed", "failed", "rejected", "executing", "approved"] as const;
type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export function ApprovalsTab() {
  const [pendingOffset, setPendingOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const overviewQuery = useGetControlOverview({ query: { queryKey: getGetControlOverviewQueryKey() } });

  const pendingParams: ListControlActionsParams = { status: "pending", limit: PAGE_SIZE, offset: pendingOffset };
  const pendingQuery = useListControlActions(pendingParams, {
    query: { queryKey: getListControlActionsQueryKey(pendingParams), refetchInterval: 20000 },
  });
  const historyParams: ListControlActionsParams = {
    limit: PAGE_SIZE,
    offset: historyOffset,
    ...(historyFilter === "all" ? {} : { status: historyFilter as ListControlActionsStatus }),
  };
  const historyQuery = useListControlActions(historyParams, {
    query: { queryKey: getListControlActionsQueryKey(historyParams), refetchInterval: 60000 },
  });

  const pending = pendingQuery.data?.actions ?? [];
  const historyRows = historyQuery.data?.actions ?? [];
  // "all" history includes pending rows from the server; they are shown above.
  const history = historyFilter === "all" ? historyRows.filter((a) => a.status !== "pending") : historyRows;
  const pendingTotal = overviewQuery.data?.counts.pendingActions ?? null;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">
          Awaiting approval ({pendingTotal ?? pending.length}) · oldest first
        </h2>
        {pendingQuery.isLoading ? (
          <TabLoading />
        ) : pending.length === 0 ? (
          <EmptyState text="No actions waiting for approval. In autonomous mode only policy changes queue here; in supervised mode every medium- or high-risk action does." />
        ) : (
          <>
            {pending.map((action) => (
              <ActionRow key={action.id} action={action} />
            ))}
            <Pager offset={pendingOffset} shown={pending.length} total={pendingTotal} onPage={setPendingOffset} />
          </>
        )}
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="mono-label text-muted-foreground">History</h2>
          <div className="flex flex-wrap gap-1.5">
            {HISTORY_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={historyFilter === value}
                onClick={() => {
                  setHistoryFilter(value);
                  setHistoryOffset(0);
                }}
                className={cn(
                  "mono-label h-8 rounded-md border px-3 transition-colors",
                  historyFilter === value
                    ? "border-primary text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
        {historyQuery.isLoading ? (
          <TabLoading />
        ) : history.length === 0 ? (
          <EmptyState text="No decided actions here yet." />
        ) : (
          history.map((action) => <ActionRow key={action.id} action={action} />)
        )}
        <Pager offset={historyOffset} shown={historyRows.length} total={null} onPage={setHistoryOffset} />
      </section>
    </div>
  );
}
