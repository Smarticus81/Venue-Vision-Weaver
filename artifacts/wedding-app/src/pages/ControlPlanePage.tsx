import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ClerkLoaded, ClerkLoading, useUser } from "@clerk/clerk-react";
import {
  useGetControlOverview,
  getGetControlOverviewQueryKey,
  useRunControlAgent,
  useSetControlAgentStatus,
  useListControlRuns,
  getListControlRunsQueryKey,
  useGetControlRun,
  getGetControlRunQueryKey,
  useListControlActions,
  getListControlActionsQueryKey,
  useDecideControlAction,
  useListControlTasks,
  getListControlTasksQueryKey,
  useSetControlTaskStatus,
  useListControlExperiments,
  getListControlExperimentsQueryKey,
  useGetControlAudit,
  getGetControlAuditQueryKey,
  useListControlPolicies,
  getListControlPoliciesQueryKey,
  type BusinessMetrics,
  type ControlAgent,
  type ControlAction,
  type ControlRun,
  type ControlTask,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2, Play, Pause, ChevronDown, ChevronUp } from "lucide-react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { ClerkSetupNotice } from "@/components/auth/OrgGate";
import { clerkConfigured } from "@/lib/clerk";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ————— Shared bits ————— */

function fmt(dateish: string | null | undefined): string {
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

function apiErrorMessage(err: unknown): string {
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
  critical: "text-red-300",
  high: "text-amber-300",
  medium: "text-foreground/70",
  low: "text-muted-foreground",
};

function Pill({ value, className }: { value: string; className?: string }) {
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

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("border border-border bg-card p-5", className)}>{children}</div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}

function ActionButton({
  onClick,
  disabled,
  tone = "neutral",
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "neutral" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
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

/* ————— Overview: KPI wall ————— */

function MetricBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-medium text-foreground">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

function MetricsWall({ metrics }: { metrics: BusinessMetrics }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <MetricBlock
        label="Organizations"
        value={String(metrics.organizations.total)}
        sub={`${metrics.organizations.paidCount} paid, ${metrics.organizations.lowCreditCount} low on credits`}
      />
      <MetricBlock
        label="Venues"
        value={String(metrics.venues.total)}
        sub={`${metrics.venues.new30d} new in 30d`}
      />
      <MetricBlock
        label="Activation rate"
        value={`${metrics.venues.activationRate}%`}
        sub={`${metrics.venues.withSessions} venues with sessions`}
      />
      <MetricBlock
        label="Sessions 7d"
        value={String(metrics.sessions.created7d)}
        sub={`${metrics.sessions.ready7d} ready, ${metrics.sessions.failed7d} failed`}
      />
      <MetricBlock
        label="Failure rate 7d"
        value={`${metrics.sessions.failureRate7d}%`}
        sub={
          metrics.sessions.avgCompletionMinutes7d != null
            ? `avg completion ${metrics.sessions.avgCompletionMinutes7d} min`
            : undefined
        }
      />
      <MetricBlock
        label="Credits consumed 30d"
        value={String(metrics.credits.consumed30d)}
        sub={`${metrics.credits.purchased30d} purchased`}
      />
      <MetricBlock
        label="Credit float"
        value={String(metrics.organizations.totalCreditsBalance)}
        sub="unspent credits across orgs"
      />
      <MetricBlock
        label="Assets generated 7d"
        value={String(metrics.assets.generated7d)}
        sub={`${metrics.sessions.total} sessions all-time`}
      />
    </div>
  );
}

/* ————— Agents fleet ————— */

function AgentCard({ agent, aiConfigured }: { agent: ControlAgent; aiConfigured: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlRunsQueryKey() });
  };

  const runAgent = useRunControlAgent({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${agent.name} run #${data.run.id} started` });
        invalidate();
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Could not start run", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const setStatus = useSetControlAgentStatus({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: data.agent.status === "paused" ? `${agent.name} paused` : `${agent.name} resumed`,
        });
        invalidate();
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Update failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });

  const paused = agent.status === "paused";
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg text-foreground">{agent.name}</p>
          <p className="mono-label mt-0.5 text-muted-foreground">{agent.domain}</p>
        </div>
        <Pill value={agent.status} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-xs text-muted-foreground">
          <p>
            Last run {fmt(agent.lastRunAt)}
            {agent.lastRunStatus ? ` (${agent.lastRunStatus})` : ""}
          </p>
          <p>Every {Math.round(agent.intervalMinutes / 60)}h</p>
        </div>
        <div className="flex items-center gap-1.5">
          <ActionButton
            tone="neutral"
            disabled={setStatus.isPending}
            onClick={() =>
              setStatus.mutate({ key: agent.key, data: { status: paused ? "active" : "paused" } })
            }
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </ActionButton>
          <ActionButton
            tone="primary"
            disabled={runAgent.isPending || !aiConfigured}
            onClick={() => runAgent.mutate({ key: agent.key })}
          >
            {runAgent.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run now
          </ActionButton>
        </div>
      </div>
    </Card>
  );
}

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
      <pre className="mt-3 overflow-x-auto border border-border bg-background/60 p-3 text-xs text-foreground/80">
        {JSON.stringify(action.params, null, 2)}
      </pre>
      {action.result ? (
        <pre className="mt-2 overflow-x-auto border border-emerald-400/20 bg-background/60 p-3 text-xs text-emerald-200/80">
          {JSON.stringify(action.result, null, 2)}
        </pre>
      ) : null}
      {action.error ? <p className="mt-2 text-xs text-red-300">{action.error}</p> : null}
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
            className="h-8 min-w-0 flex-1 border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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

function ApprovalsTab() {
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

/* ————— Tasks ————— */

function TaskRow({ task }: { task: ControlTask }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const setStatus = useSetControlTaskStatus({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListControlTasksQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Update failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });

  const move = (status: "open" | "in_progress" | "done" | "dismissed") =>
    setStatus.mutate({ id: task.id, data: { status } });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Pill value={task.status} />
          <Pill value={task.priority} />
          <span className="mono-label text-muted-foreground">
            {task.agentKey}
            {task.category ? ` · ${task.category}` : ""} · {fmt(task.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {task.status === "open" ? (
            <ActionButton tone="neutral" disabled={setStatus.isPending} onClick={() => move("in_progress")}>
              Start
            </ActionButton>
          ) : null}
          {task.status !== "done" && task.status !== "dismissed" ? (
            <>
              <ActionButton tone="primary" disabled={setStatus.isPending} onClick={() => move("done")}>
                Done
              </ActionButton>
              <ActionButton tone="danger" disabled={setStatus.isPending} onClick={() => move("dismissed")}>
                Dismiss
              </ActionButton>
            </>
          ) : (
            <ActionButton tone="neutral" disabled={setStatus.isPending} onClick={() => move("open")}>
              Reopen
            </ActionButton>
          )}
        </div>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{task.title}</p>
      {task.detail ? (
        <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
          {task.detail}
        </p>
      ) : null}
    </Card>
  );
}

const TASK_FILTERS = ["all", "open", "in_progress", "done", "dismissed"] as const;

function TasksTab() {
  const [filter, setFilter] = useState<(typeof TASK_FILTERS)[number]>("all");
  const params = filter === "all" ? {} : { status: filter };
  const tasksQuery = useListControlTasks(params, {
    query: { queryKey: getListControlTasksQueryKey(params), refetchInterval: 30000 },
  });
  const tasks = tasksQuery.data?.tasks ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {TASK_FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              "mono-label h-8 border px-3 transition-colors",
              filter === value
                ? "border-rose/60 text-rose"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {value.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      {tasksQuery.isLoading ? (
        <TabLoading />
      ) : tasks.length === 0 ? (
        <EmptyState text="No tasks here. Agents raise work items for the operator team as they find issues and opportunities." />
      ) : (
        tasks.map((task) => <TaskRow key={task.id} task={task} />)
      )}
    </div>
  );
}

/* ————— Runs ————— */

function RunTranscript({ runId }: { runId: number }) {
  const runQuery = useGetControlRun(runId, {
    query: { queryKey: getGetControlRunQueryKey(runId) },
  });
  if (runQuery.isLoading) return <TabLoading />;
  const run = runQuery.data?.run;
  if (!run) return <p className="text-xs text-red-300">Could not load run detail.</p>;
  const transcript = (run.transcript ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="space-y-2">
      {run.summary ? (
        <div className="border border-border bg-background/60 p-3">
          <p className="mono-label mb-1.5 text-muted-foreground">Operator report</p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{run.summary}</p>
        </div>
      ) : null}
      {run.error ? <p className="text-xs text-red-300">{run.error}</p> : null}
      {transcript.length > 0 ? (
        <div className="border border-border bg-background/60 p-3">
          <p className="mono-label mb-2 text-muted-foreground">
            Transcript ({transcript.length} steps)
          </p>
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {transcript.map((step, index) => (
              <div key={index} className="text-xs">
                {step.type === "text" ? (
                  <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">
                    {String(step.text ?? "")}
                  </p>
                ) : step.type === "tool_call" ? (
                  <p className="font-mono text-rose/90">
                    → {String(step.name ?? "")}({JSON.stringify(step.args ?? {})})
                  </p>
                ) : (
                  <p className={cn("font-mono", step.error ? "text-red-300" : "text-muted-foreground")}>
                    ← {String(step.name ?? "")}:{" "}
                    {step.error
                      ? String(step.error)
                      : `${JSON.stringify(step.result ?? null).slice(0, 400)}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RunRow({ run }: { run: ControlRun }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-3">
          <Pill value={run.status} />
          <span className="text-sm font-medium text-foreground">{run.agentKey}</span>
          <span className="mono-label text-muted-foreground">
            #{run.id} · {run.trigger} · {fmt(run.startedAt)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="mono-label text-muted-foreground">
            {run.toolCallCount} tool calls
            {run.promptTokens != null ? ` · ${(run.promptTokens + (run.completionTokens ?? 0)).toLocaleString()} tokens` : ""}
          </span>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {!open && run.summary ? (
        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{run.summary}</p>
      ) : null}
      {open ? (
        <div className="mt-3 border-t border-border pt-3">
          <RunTranscript runId={run.id} />
        </div>
      ) : null}
    </Card>
  );
}

function RunsTab() {
  const runsQuery = useListControlRuns(
    {},
    { query: { queryKey: getListControlRunsQueryKey(), refetchInterval: 15000 } },
  );
  const runs = runsQuery.data?.runs ?? [];
  if (runsQuery.isLoading) return <TabLoading />;
  if (runs.length === 0) {
    return (
      <EmptyState text="No runs yet. The scheduler runs each active agent on its interval, or trigger one from the Agents section." />
    );
  }
  return (
    <div className="space-y-3">
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </div>
  );
}

/* ————— Experiments ————— */

function ExperimentsTab() {
  const experimentsQuery = useListControlExperiments(
    {},
    { query: { queryKey: getListControlExperimentsQueryKey() } },
  );
  const experiments = experimentsQuery.data?.experiments ?? [];
  if (experimentsQuery.isLoading) return <TabLoading />;
  if (experiments.length === 0) {
    return (
      <EmptyState text="No experiments yet. The growth and experiments agents register hypotheses here and read them out against live metrics." />
    );
  }
  return (
    <div className="space-y-3">
      {experiments.map((experiment) => (
        <Card key={experiment.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Pill value={experiment.status} />
              <span className="text-sm font-medium text-foreground">{experiment.name}</span>
            </div>
            <span className="mono-label text-muted-foreground">
              {experiment.createdByAgent ?? "operator"} · {fmt(experiment.createdAt)}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            <span className="text-foreground/70">Hypothesis:</span> {experiment.hypothesis}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-foreground/70">Primary metric:</span> {experiment.metric}
          </p>
          {experiment.result ? (
            <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-foreground/85">
              <span className="mono-label mr-2 text-muted-foreground">Readout</span>
              {experiment.result}
            </p>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

/* ————— Audit + policies ————— */

function AuditTab() {
  const auditQuery = useGetControlAudit(
    {},
    { query: { queryKey: getGetControlAuditQueryKey(), refetchInterval: 30000 } },
  );
  const policiesQuery = useListControlPolicies({
    query: { queryKey: getListControlPoliciesQueryKey() },
  });
  const events = auditQuery.data?.events ?? [];
  const policies = policiesQuery.data?.policies ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Governance policies</h2>
        {policies.length === 0 ? (
          <EmptyState text="Policies are seeded when the control-plane worker first starts." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {policies.map((policy) => (
              <Card key={policy.id}>
                <p className="font-mono text-xs text-rose/90">{policy.key}</p>
                <p className="mt-1 font-mono text-xs text-foreground/85">
                  {JSON.stringify(policy.value)}
                </p>
                {policy.description ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {policy.description}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Audit trail</h2>
        {auditQuery.isLoading ? (
          <TabLoading />
        ) : events.length === 0 ? (
          <EmptyState text="Every agent proposal, operator decision, and execution is recorded here." />
        ) : (
          <Card className="p-0">
            <div className="max-h-[36rem] divide-y divide-border overflow-y-auto">
              {events.map((event) => (
                <div key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
                  <span className="mono-label w-32 shrink-0 text-muted-foreground">
                    {fmt(event.createdAt)}
                  </span>
                  <span className="mono-label text-rose/80">{event.actorType}:{event.actor}</span>
                  <span className="text-xs font-medium text-foreground/90">
                    {event.eventType.replace(/_/g, " ")}
                  </span>
                  {event.subjectType ? (
                    <span className="mono-label text-muted-foreground">
                      {event.subjectType} {event.subjectId}
                    </span>
                  ) : null}
                  {event.detail ? (
                    <span className="min-w-0 break-all font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(event.detail).slice(0, 220)}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

/* ————— Console shell ————— */

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-rose" />
    </div>
  );
}

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "runs", label: "Runs" },
  { id: "experiments", label: "Experiments" },
  { id: "audit", label: "Audit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function ControlConsole() {
  const [tab, setTab] = useState<TabId>("overview");
  const overviewQuery = useGetControlOverview({
    query: { queryKey: getGetControlOverviewQueryKey(), refetchInterval: 30000, retry: 1 },
  });

  const overview = overviewQuery.data;
  const errorStatus = (overviewQuery.error as { status?: number } | null)?.status;

  const badgeCounts = useMemo(
    () => ({
      approvals: overview?.counts.pendingActions ?? 0,
      tasks: overview?.counts.openTasks ?? 0,
    }),
    [overview],
  );

  if (overviewQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-rose" />
      </div>
    );
  }

  if (overviewQuery.isError || !overview) {
    const message = apiErrorMessage(overviewQuery.error);
    return (
      <div className="grain relative flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-md border border-border bg-card p-8">
          <p className="mono-label mb-4 text-rose">
            {errorStatus === 401 ? "Sign in required" : "Access"}
          </p>
          <h1 className="font-display text-2xl font-medium">
            {errorStatus === 401
              ? "Sign in to open the control plane"
              : errorStatus === 403
                ? "Operator access required"
                : "Control plane unavailable"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{message}</p>
          {errorStatus === 401 ? (
            <Link
              href="/login"
              className="mt-6 inline-flex h-11 items-center justify-center bg-rose px-6 text-sm font-medium text-rose-foreground transition-colors hover:bg-rose-hover"
            >
              Go to sign in
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grain relative min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <GlimpseLogo href="/" className="text-[1.1rem] sm:text-[1.2rem]" />
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="mono-label truncate text-muted-foreground">Business control plane</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{overview.operatorEmail}</span>
            <span
              className={cn(
                "mono-label inline-flex items-center gap-1.5",
                overview.aiConfigured ? "text-emerald-300" : "text-amber-300",
              )}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {overview.aiConfigured ? overview.model : "AI not configured"}
            </span>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {TABS.map((entry) => {
            const badge =
              entry.id === "approvals"
                ? badgeCounts.approvals
                : entry.id === "tasks"
                  ? badgeCounts.tasks
                  : 0;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                className={cn(
                  "mono-label flex h-8 shrink-0 items-center gap-1.5 border-b-2 px-3 transition-colors",
                  tab === entry.id
                    ? "border-rose text-rose"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
                {badge > 0 ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose px-1 text-[10px] font-semibold text-rose-foreground">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {tab === "overview" ? (
          <div className="space-y-8">
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="mono-label text-muted-foreground">Business pulse</h2>
                <span className="mono-label text-muted-foreground">
                  {overview.counts.runs24h} runs in 24h · {overview.counts.runningExperiments} experiments running
                </span>
              </div>
              <MetricsWall metrics={overview.metrics} />
            </section>
            <section className="space-y-3">
              <h2 className="mono-label text-muted-foreground">Agent fleet</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {overview.agents.map((agent) => (
                  <AgentCard key={agent.key} agent={agent} aiConfigured={overview.aiConfigured} />
                ))}
              </div>
            </section>
          </div>
        ) : tab === "approvals" ? (
          <ApprovalsTab />
        ) : tab === "tasks" ? (
          <TasksTab />
        ) : tab === "runs" ? (
          <RunsTab />
        ) : tab === "experiments" ? (
          <ExperimentsTab />
        ) : (
          <AuditTab />
        )}
      </main>
    </div>
  );
}

function SignedInGate() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return <TabLoading />;
  if (!isSignedIn) {
    return (
      <div className="grain relative flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-md border border-border bg-card p-8">
          <p className="mono-label mb-4 text-rose">Sign in required</p>
          <h1 className="font-display text-2xl font-medium">Operator sign-in</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The control plane is restricted to platform operators. Sign in with your operator
            account to continue.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center justify-center bg-rose px-6 text-sm font-medium text-rose-foreground transition-colors hover:bg-rose-hover"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }
  return <ControlConsole />;
}

export default function ControlPlanePage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <>
      <ClerkLoading>
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-rose" />
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignedInGate />
      </ClerkLoaded>
    </>
  );
}
