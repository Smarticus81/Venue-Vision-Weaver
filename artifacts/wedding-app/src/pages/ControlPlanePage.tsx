import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ClerkLoaded, ClerkLoading, useUser } from "@clerk/clerk-react";
import {
  useGetControlOverview,
  getGetControlOverviewQueryKey,
  useListControlRuns,
  getListControlRunsQueryKey,
  useGetControlRun,
  getGetControlRunQueryKey,
  type ControlRun,
} from "@workspace/api-client-react";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { DreemerLogo } from "@/components/brand/DreemerLogo";
import { ClerkSetupNotice } from "@/components/auth/OrgGate";
import { clerkConfigured } from "@/lib/clerk";
import { cn } from "@/lib/utils";
import { Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./control/shared";
import { OverviewTab } from "./control/OverviewTab";
import { GrowthTab } from "./control/GrowthTab";
import { PipelineTab } from "./control/PipelineTab";
import { OutreachStudioTab } from "./control/OutreachStudioTab";
import { ApprovalsTab } from "./control/ApprovalsTab";
import { TasksTab } from "./control/TasksTab";
import { ExperimentsTab } from "./control/ExperimentsTab";
import { AuditTab } from "./control/AuditTab";

/* ————— Runs ————— */

function RunTranscript({ runId }: { runId: number }) {
  const runQuery = useGetControlRun(runId, {
    query: { queryKey: getGetControlRunQueryKey(runId) },
  });
  if (runQuery.isLoading) return <TabLoading />;
  const run = runQuery.data?.run;
  if (!run) return <p className="text-xs text-danger">Could not load run detail.</p>;
  const transcript = (run.transcript ?? []) as Array<Record<string, unknown>>;
  return (
    <div className="space-y-2">
      {run.summary ? (
        <div className="rounded-md border border-border bg-background/60 p-3">
          <p className="mono-label mb-1.5 text-muted-foreground">Operator report</p>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{run.summary}</p>
        </div>
      ) : null}
      {run.error ? <p className="text-xs text-danger">{run.error}</p> : null}
      {transcript.length > 0 ? (
        <div className="rounded-md border border-border bg-background/60 p-3">
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
                  <p className="font-mono text-brand">
                    → {String(step.name ?? "")}({JSON.stringify(step.args ?? {})})
                  </p>
                ) : (
                  <p className={cn("font-mono", step.error ? "text-danger" : "text-muted-foreground")}>
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

/* ————— Console shell ————— */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "growth", label: "Growth" },
  { id: "pipeline", label: "Pipeline" },
  { id: "outreach", label: "Outreach" },
  { id: "approvals", label: "Approvals" },
  { id: "tasks", label: "Tasks" },
  { id: "runs", label: "Runs" },
  { id: "experiments", label: "Experiments" },
  { id: "audit", label: "Audit" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function initialTab(): TabId {
  const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
  return TABS.some((entry) => entry.id === hash) ? (hash as TabId) : "overview";
}

function ControlConsole() {
  const [tab, setTabState] = useState<TabId>(initialTab);
  const setTab = (next: TabId) => {
    setTabState(next);
    if (typeof window !== "undefined") window.history.replaceState(null, "", `#${next}`);
  };
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
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (overviewQuery.isError || !overview) {
    const message = apiErrorMessage(overviewQuery.error);
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
          <p className="mono-label mb-4 text-brand">
            {errorStatus === 401 ? "Sign in required" : "Access"}
          </p>
          <h1 className="font-display text-2xl font-semibold">
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
              className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand-hover"
            >
              Go to sign in
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <DreemerLogo href="/" className="text-[1.1rem] sm:text-[1.2rem]" />
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="mono-label truncate text-muted-foreground">Control plane</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{overview.operatorEmail}</span>
            <span
              className={cn(
                "mono-label inline-flex items-center gap-1.5",
                overview.aiConfigured ? "text-success" : "text-warning",
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
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {entry.label}
                {badge > 0 ? (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
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
          <OverviewTab overview={overview} />
        ) : tab === "growth" ? (
          <GrowthTab />
        ) : tab === "pipeline" ? (
          <PipelineTab />
        ) : tab === "outreach" ? (
          <OutreachStudioTab />
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
      <div className="relative flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="w-full max-w-md rounded-lg border border-border bg-card p-8">
          <p className="mono-label mb-4 text-brand">Sign in required</p>
          <h1 className="font-display text-2xl font-semibold">Operator sign-in</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The control plane is restricted to platform operators. Sign in with your operator
            account to continue.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-brand-hover"
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
          <Loader2 className="h-8 w-8 animate-spin text-brand" />
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <SignedInGate />
      </ClerkLoaded>
    </>
  );
}
