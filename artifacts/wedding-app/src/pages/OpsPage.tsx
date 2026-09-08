import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Loader2, RefreshCw } from "lucide-react";
import {
  useApproveControlPlaneDecision,
  useCreateControlPlaneLead,
  useCreateControlPlaneTicket,
  useGetControlPlaneOverview,
  useListControlPlaneAudit,
  useListControlPlaneDecisions,
  useListControlPlaneLeads,
  useListControlPlaneMemory,
  useListControlPlaneTickets,
  useListControlPlaneWorkItems,
  useRejectControlPlaneDecision,
  useRunControlPlaneAgent,
  useRunControlPlaneTick,
  useSetControlPlaneKillSwitch,
  useUpdateControlPlaneAgent,
  useUpdateControlPlanePolicy,
  useUpdateControlPlaneTicket,
  useUpdateControlPlaneWorkItem,
  getGetControlPlaneOverviewQueryKey,
  getListControlPlaneAuditQueryKey,
  getListControlPlaneDecisionsQueryKey,
  getListControlPlaneLeadsQueryKey,
  getListControlPlaneMemoryQueryKey,
  getListControlPlaneTicketsQueryKey,
  getListControlPlaneWorkItemsQueryKey,
  type ControlPlaneAutonomy,
  type ControlPlanePolicy,
} from "@workspace/api-client-react";
import { GlimpseLogo } from "@/components/brand/GlimpseLogo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ClerkSetupNotice, OrgGate } from "@/components/auth/OrgGate";
import { clerkConfigured } from "@/lib/clerk";
import { cn } from "@/lib/utils";
import { DecisionQueue, DecisionQueuePanel } from "./ops/DecisionQueue";
import { FleetGrid } from "./ops/FleetGrid";
import {
  ExperimentsPanel,
  ProductPanel,
  SalesPanel,
  SupportPanel,
} from "./ops/DomainPanels";
import { GovernancePanel } from "./ops/GovernancePanel";
import {
  EmptyState,
  ObservationStat,
  Panel,
  SeverityPill,
  Stat,
  formatNumber,
  formatPercentValue,
  formatRelative,
} from "./ops/primitives";

const TABS = [
  "Overview",
  "Fleet",
  "Decisions",
  "Support",
  "Sales",
  "Product",
  "Experiments",
  "Governance",
] as const;
type Tab = (typeof TABS)[number];

export default function OpsPage() {
  if (!clerkConfigured) return <ClerkSetupNotice />;
  return (
    <OrgGate>
      <OpsConsole />
    </OrgGate>
  );
}

function OpsConsole() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("Overview");
  const [busyAgentKey, setBusyAgentKey] = useState<string | null>(null);
  const [busyDecisionId, setBusyDecisionId] = useState<number | null>(null);
  const [busyRowId, setBusyRowId] = useState<number | null>(null);

  const overviewQuery = useGetControlPlaneOverview({
    query: { queryKey: getGetControlPlaneOverviewQueryKey(), retry: 1, refetchInterval: 60_000 },
  });
  // Domain surfaces load only while their tab is open: the overview already
  // carries what the operator sees first, and these lists are unbounded.
  const decisionsQuery = useListControlPlaneDecisions(
    { status: "all", limit: 100 },
    {
      query: {
        queryKey: getListControlPlaneDecisionsQueryKey({ status: "all", limit: 100 }),
        enabled: tab === "Decisions",
      },
    },
  );
  const ticketsQuery = useListControlPlaneTickets(
    { limit: 100 },
    {
      query: {
        queryKey: getListControlPlaneTicketsQueryKey({ limit: 100 }),
        enabled: tab === "Support",
      },
    },
  );
  const leadsQuery = useListControlPlaneLeads(
    { limit: 100 },
    {
      query: {
        queryKey: getListControlPlaneLeadsQueryKey({ limit: 100 }),
        enabled: tab === "Sales",
      },
    },
  );
  const workItemsQuery = useListControlPlaneWorkItems(
    { limit: 100 },
    {
      query: {
        queryKey: getListControlPlaneWorkItemsQueryKey({ limit: 100 }),
        enabled: tab === "Product",
      },
    },
  );
  const auditQuery = useListControlPlaneAudit(
    { limit: 60 },
    {
      query: {
        queryKey: getListControlPlaneAuditQueryKey({ limit: 60 }),
        enabled: tab === "Governance",
      },
    },
  );
  const memoryQuery = useListControlPlaneMemory(
    { limit: 40 },
    {
      query: {
        queryKey: getListControlPlaneMemoryQueryKey({ limit: 40 }),
        enabled: tab === "Governance",
      },
    },
  );

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: getGetControlPlaneOverviewQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlPlaneDecisionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlPlaneTicketsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlPlaneLeadsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlPlaneWorkItemsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlPlaneAuditQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlPlaneMemoryQueryKey() });
  };

  const failed = (title: string) => (error: unknown) => {
    toast({
      title,
      description: error instanceof Error ? error.message : "Something went wrong.",
      variant: "destructive",
    });
  };

  const tickMutation = useRunControlPlaneTick({
    mutation: {
      onSuccess: (result) => {
        invalidateAll();
        const executed = result.ran.reduce((sum, entry) => sum + entry.executed, 0);
        const proposed = result.ran.reduce((sum, entry) => sum + entry.proposed, 0);
        toast({
          title: result.ran.length ? `Ran ${result.ran.length} agents` : "Nothing was due",
          description: result.ran.length
            ? `${proposed} decisions proposed, ${executed} executed within policy.`
            : result.narrative,
        });
      },
      onError: failed("The tick failed"),
    },
  });

  const runAgentMutation = useRunControlPlaneAgent({
    mutation: {
      onSuccess: (result) => {
        setBusyAgentKey(null);
        invalidateAll();
        const entry = result.ran[0];
        toast({
          title: entry ? `${entry.agentKey} ran` : "Agent ran",
          description: entry?.summary ?? result.narrative,
        });
      },
      onError: (error) => {
        setBusyAgentKey(null);
        failed("The agent could not run")(error);
      },
    },
  });

  const updateAgentMutation = useUpdateControlPlaneAgent({
    mutation: { onSuccess: invalidateAll, onError: failed("Could not update the agent") },
  });

  const approveMutation = useApproveControlPlaneDecision({
    mutation: {
      onSuccess: (result) => {
        setBusyDecisionId(null);
        invalidateAll();
        toast({
          title: result.executed ? "Decision executed" : "Decision could not run",
          description: result.executed
            ? result.decision?.title
            : (result.error ?? "The effect was refused."),
          variant: result.executed ? undefined : "destructive",
        });
      },
      onError: (error) => {
        setBusyDecisionId(null);
        failed("Approval failed")(error);
      },
    },
  });

  const rejectMutation = useRejectControlPlaneDecision({
    mutation: {
      onSuccess: () => {
        setBusyDecisionId(null);
        invalidateAll();
        toast({ title: "Decision rejected" });
      },
      onError: (error) => {
        setBusyDecisionId(null);
        failed("Could not reject")(error);
      },
    },
  });

  const policyMutation = useUpdateControlPlanePolicy({
    mutation: { onSuccess: invalidateAll, onError: failed("Could not change the guardrail") },
  });

  const killSwitchMutation = useSetControlPlaneKillSwitch({
    mutation: {
      onSuccess: (result) => {
        invalidateAll();
        toast({
          title: result.policy.killSwitch ? "Kill switch engaged" : "Kill switch released",
          description: result.policy.killSwitch
            ? "Nothing will execute until you release it."
            : "Agents may execute within their guardrails again.",
        });
      },
      onError: failed("Could not toggle the kill switch"),
    },
  });

  const ticketMutation = useUpdateControlPlaneTicket({
    mutation: {
      onSuccess: () => {
        setBusyRowId(null);
        invalidateAll();
      },
      onError: (error) => {
        setBusyRowId(null);
        failed("Could not update the ticket")(error);
      },
    },
  });

  const createTicketMutation = useCreateControlPlaneTicket({
    mutation: { onSuccess: invalidateAll, onError: failed("Could not open the ticket") },
  });

  const createLeadMutation = useCreateControlPlaneLead({
    mutation: { onSuccess: invalidateAll, onError: failed("Could not add the lead") },
  });

  const workItemMutation = useUpdateControlPlaneWorkItem({
    mutation: {
      onSuccess: () => {
        setBusyRowId(null);
        invalidateAll();
      },
      onError: (error) => {
        setBusyRowId(null);
        failed("Could not update the work item")(error);
      },
    },
  });

  const overview = overviewQuery.data;
  const notMigrated =
    overviewQuery.error instanceof Error &&
    "status" in overviewQuery.error &&
    (overviewQuery.error as { status?: number }).status === 503;

  const openDecisionCount = overview?.snapshot.ledger.openCount ?? 0;

  const observations = useMemo(() => {
    if (!overview) return [];
    return [...overview.state.concerns, ...overview.state.highlights];
  }, [overview]);

  if (overviewQuery.isLoading) return <OpsSkeleton />;

  if (notMigrated) {
    return (
      <OpsShell tab={tab} setTab={setTab} onTick={() => {}} ticking={false} openDecisions={0}>
        <Panel eyebrow="Setup required" title="The control plane is not migrated yet">
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            The fleet's tables do not exist on this database. Run{" "}
            <span className="font-mono text-foreground">pnpm run db:push</span> against the
            production database and reload — the eight agents provision themselves on the next tick.
          </p>
        </Panel>
      </OpsShell>
    );
  }

  if (overviewQuery.isError || !overview) {
    return (
      <OpsShell tab={tab} setTab={setTab} onTick={() => {}} ticking={false} openDecisions={0}>
        <Panel eyebrow="Unavailable" title="Could not load the control plane">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : "The overview request failed."}
          </p>
          <Button className="mt-4" size="sm" variant="secondary" onClick={() => overviewQuery.refetch()}>
            Try again
          </Button>
        </Panel>
      </OpsShell>
    );
  }

  const { snapshot, state, policy, fleet, recentRuns } = overview;
  const funnel = snapshot.funnel;
  const deliveryRate = funnel.last7d.started > 0 ? funnel.last7d.ready / funnel.last7d.started : null;

  return (
    <OpsShell
      tab={tab}
      setTab={setTab}
      onTick={() => tickMutation.mutate()}
      ticking={tickMutation.isPending}
      openDecisions={openDecisionCount}
    >
      {policy.killSwitch && (
        <div className="mb-4 rounded-lg border border-red-400/40 bg-red-400/5 px-4 py-3">
          <p className="mono-label mb-1 text-red-300">Kill switch engaged</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Agents are still observing and proposing, but nothing will execute — including decisions
            you approve. Release it from Governance.
          </p>
        </div>
      )}

      {tab === "Overview" && (
        <div className="space-y-4">
          <section className="glimpse-card p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3">
              <SeverityPill severity={state.severity} />
              <span className="mono-label text-muted-foreground">
                as of {formatRelative(snapshot.now)}
              </span>
            </div>
            <h1 className="mt-3 font-display text-2xl font-medium leading-tight sm:text-3xl">
              {state.headline}
            </h1>
            <p className="mt-3 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {state.narrative}
            </p>
          </section>

          <Panel eyebrow="This week" title="Delivery">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat
                label="Gallery starts, 7d"
                value={formatNumber(funnel.last7d.started)}
                detail={`${funnel.prev7d.started} the week before`}
              />
              <Stat
                label="Delivered, 7d"
                value={formatNumber(funnel.last7d.ready)}
                detail={deliveryRate === null ? undefined : `${formatPercentValue(deliveryRate)} of starts`}
              />
              <Stat
                label="Failed, 24h"
                value={formatNumber(funnel.last24h.failed)}
                severity={funnel.last24h.failed > 0 ? "warning" : "info"}
              />
              <Stat
                label="Median minutes to deliver"
                value={
                  funnel.last7d.medianMinutesToReady === null ||
                  funnel.last7d.medianMinutesToReady === undefined
                    ? "—"
                    : formatNumber(funnel.last7d.medianMinutesToReady, 1)
                }
              />
            </div>
          </Panel>

          <Panel eyebrow="Money" title="Credits and margin">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Stat
                label="Credit balance"
                value={formatNumber(snapshot.finance.creditsBalance)}
                detail={`${formatNumber(snapshot.finance.creditsBurned7d)} burned in 7d`}
              />
              <Stat
                label="Runway"
                value={
                  snapshot.finance.runwayDays === null || snapshot.finance.runwayDays === undefined
                    ? "—"
                    : `${formatNumber(snapshot.finance.runwayDays, 1)}d`
                }
                severity={
                  snapshot.finance.runwayDays !== null &&
                  snapshot.finance.runwayDays !== undefined &&
                  snapshot.finance.runwayDays <= 7
                    ? "critical"
                    : "info"
                }
              />
              <Stat
                label="Generation cost, 30d"
                value={`$${formatNumber(snapshot.finance.estimatedCogsUsd30d, 2)}`}
              />
              <Stat
                label="Plan"
                value={snapshot.organization.plan}
                detail={snapshot.organization.hasSubscription ? "subscription active" : "no subscription"}
              />
            </div>
          </Panel>

          <DecisionQueuePanel
            decisions={overview.openDecisions}
            onApprove={(id) => {
              setBusyDecisionId(id);
              approveMutation.mutate({ id, data: {} });
            }}
            onReject={(id) => {
              setBusyDecisionId(id);
              rejectMutation.mutate({ id, data: {} });
            }}
            busyId={busyDecisionId}
          />

          {observations.length > 0 && (
            <Panel eyebrow="Measurements" title="What the fleet last saw">
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
                {observations.slice(0, 12).map((observation) => (
                  <ObservationStat key={observation.key} observation={observation} />
                ))}
              </div>
            </Panel>
          )}

          <Panel eyebrow="Activity" title="Recent agent runs">
            {recentRuns.length === 0 ? (
              <EmptyState>No runs yet. Trigger one from the header.</EmptyState>
            ) : (
              <ul className="space-y-3">
                {recentRuns.map((run) => (
                  <li key={run.id} className="border-b border-border/50 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="mono-label text-rose">{run.agentKey}</span>
                      <span
                        className={cn(
                          "mono-label",
                          run.status === "failed" ? "text-red-300" : "text-muted-foreground",
                        )}
                      >
                        {run.status}
                      </span>
                      <span className="mono-label ml-auto text-muted-foreground">
                        {formatRelative(run.startedAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-foreground/90">
                      {run.summary ?? run.error ?? "No summary recorded."}
                    </p>
                    {run.narrative && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {run.narrative}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {tab === "Fleet" && (
        <FleetGrid
          agents={fleet}
          busyAgentKey={busyAgentKey}
          onRun={(agentKey) => {
            setBusyAgentKey(agentKey);
            runAgentMutation.mutate({ agentKey });
          }}
          onUpdate={(agentKey, patch) =>
            updateAgentMutation.mutate({
              agentKey,
              data: patch as { autonomy?: ControlPlaneAutonomy; enabled?: boolean },
            })
          }
        />
      )}

      {tab === "Decisions" && (
        <Panel eyebrow="Ledger" title="Every decision the fleet has made">
          {decisionsQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <DecisionQueue
              decisions={decisionsQuery.data?.decisions ?? []}
              busyId={busyDecisionId}
              onApprove={(id) => {
                setBusyDecisionId(id);
                approveMutation.mutate({ id, data: {} });
              }}
              onReject={(id) => {
                setBusyDecisionId(id);
                rejectMutation.mutate({ id, data: {} });
              }}
              emptyMessage="No decisions recorded yet."
            />
          )}
        </Panel>
      )}

      {tab === "Support" && (
        <SupportPanel
          tickets={ticketsQuery.data?.tickets ?? []}
          busyId={busyRowId}
          onResolve={(id) => {
            setBusyRowId(id);
            ticketMutation.mutate({ id, data: { status: "resolved" } });
          }}
          onOpenTicket={(subject, body) =>
            createTicketMutation.mutate({ data: { subject, body } })
          }
        />
      )}

      {tab === "Sales" && (
        <SalesPanel
          leads={leadsQuery.data?.leads ?? []}
          creating={createLeadMutation.isPending}
          onCreate={(lead) => createLeadMutation.mutate({ data: lead })}
        />
      )}

      {tab === "Product" && (
        <ProductPanel
          workItems={workItemsQuery.data?.workItems ?? snapshot.workItems ?? []}
          busyId={busyRowId}
          onStatus={(id, status) => {
            setBusyRowId(id);
            workItemMutation.mutate({
              id,
              data: { status: status as "open" | "in_progress" | "blocked" | "done" | "cancelled" },
            });
          }}
        />
      )}

      {tab === "Experiments" && <ExperimentsPanel experiments={snapshot.experiments ?? []} />}

      {tab === "Governance" && (
        <GovernancePanel
          policy={policy}
          saving={policyMutation.isPending || killSwitchMutation.isPending}
          audit={auditQuery.data?.entries ?? []}
          memory={memoryQuery.data?.notes ?? []}
          onPolicyChange={(patch) =>
            policyMutation.mutate({ data: patch as Partial<ControlPlanePolicy> })
          }
          onKillSwitch={(engaged) => killSwitchMutation.mutate({ data: { engaged } })}
        />
      )}
    </OpsShell>
  );
}

function OpsShell({
  tab,
  setTab,
  onTick,
  ticking,
  openDecisions,
  children,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  onTick: () => void;
  ticking: boolean;
  openDecisions: number;
  children: React.ReactNode;
}) {
  return (
    <div className="grain min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <GlimpseLogo href="/dashboard" className="text-[1.1rem] sm:text-[1.2rem]" />
            <span aria-hidden className="h-4 w-px bg-border" />
            <span className="mono-label text-rose">Control plane</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/dashboard"
              className="mono-label hidden text-muted-foreground underline-offset-4 hover:underline sm:inline"
            >
              Dashboard
            </Link>
            <Button size="sm" variant="secondary" onClick={onTick} disabled={ticking}>
              {ticking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Run the fleet
            </Button>
          </div>
        </div>
        <nav className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
          <ul className="flex gap-1 pb-1">
            {TABS.map((entry) => (
              <li key={entry}>
                <button
                  type="button"
                  onClick={() => setTab(entry)}
                  className={cn(
                    "mono-label relative whitespace-nowrap px-3 py-2 transition-colors",
                    tab === entry ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {entry}
                  {entry === "Decisions" && openDecisions > 0 && (
                    <span className="ml-1.5 rounded-full bg-rose px-1.5 py-0.5 text-[0.6rem] text-rose-foreground">
                      {openDecisions}
                    </span>
                  )}
                  {tab === entry && (
                    <span aria-hidden className="absolute inset-x-2 -bottom-px h-px bg-rose" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

function OpsSkeleton() {
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
