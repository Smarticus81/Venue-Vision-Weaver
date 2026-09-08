import { useState } from "react";
import { Loader2, Pause, Play, Zap } from "lucide-react";
import type { ControlPlaneAgent, ControlPlaneAutonomy } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, formatRelative } from "./primitives";

const AUTONOMY_OPTIONS: { value: ControlPlaneAutonomy; label: string; hint: string }[] = [
  { value: "observe", label: "Observe", hint: "Watches and records. Proposes nothing." },
  { value: "recommend", label: "Recommend", hint: "Proposes everything, executes nothing." },
  { value: "supervised", label: "Supervised", hint: "Executes low-risk decisions on its own." },
  { value: "autonomous", label: "Autonomous", hint: "Executes low and medium risk on its own." },
];

const DOMAIN_ORDER = [
  "product",
  "support",
  "activation",
  "growth",
  "finance",
  "experiments",
  "sales",
  "governance",
];

function healthTone(agent: ControlPlaneAgent): string {
  if (!agent.enabled) return "text-muted-foreground";
  if (agent.lastError) return "text-red-300";
  if ((agent.failedRuns24h ?? 0) > 0) return "text-amber-300";
  return "text-emerald-300";
}

export function FleetGrid({
  agents,
  onUpdate,
  onRun,
  busyAgentKey,
}: {
  agents: ControlPlaneAgent[];
  onUpdate: (agentKey: string, patch: { enabled?: boolean; autonomy?: ControlPlaneAutonomy }) => void;
  onRun: (agentKey: string) => void;
  busyAgentKey: string | null;
}) {
  const ordered = [...agents].sort(
    (a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain),
  );

  if (!ordered.length) {
    return (
      <Panel eyebrow="Fleet" title="No agents registered yet">
        <EmptyState>
          The fleet provisions itself on the first tick. Run one from the overview to bring the eight
          domain agents online.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {ordered.map((agent) => (
        <AgentCard
          key={agent.agentKey}
          agent={agent}
          onUpdate={onUpdate}
          onRun={onRun}
          busy={busyAgentKey === agent.agentKey}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent,
  onUpdate,
  onRun,
  busy,
}: {
  agent: ControlPlaneAgent;
  onUpdate: (agentKey: string, patch: { enabled?: boolean; autonomy?: ControlPlaneAutonomy }) => void;
  onRun: (agentKey: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const budgetUsed = agent.dailyActionBudget > 0 ? agent.actionsToday / agent.dailyActionBudget : 0;

  return (
    <article
      className={cn(
        "glimpse-card flex flex-col gap-4 p-5",
        !agent.enabled && "opacity-60",
        agent.lastError && "border-red-400/30",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono-label mb-1 text-muted-foreground">{agent.domain}</p>
          <h3 className="font-display text-base font-medium leading-tight">{agent.displayName}</h3>
        </div>
        <span className={cn("mono-label shrink-0", healthTone(agent))}>
          {agent.enabled ? (agent.lastError ? "error" : agent.status) : "paused"}
        </span>
      </header>

      {agent.charter && (
        <p className="text-sm leading-relaxed text-muted-foreground">{agent.charter}</p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <dt className="mono-label text-muted-foreground">Last run</dt>
          <dd className="mt-0.5 text-foreground">{formatRelative(agent.lastRunAt)}</dd>
        </div>
        <div>
          <dt className="mono-label text-muted-foreground">Runs 24h</dt>
          <dd className="mt-0.5 text-foreground">
            {agent.succeededRuns24h ?? 0} ok
            {(agent.failedRuns24h ?? 0) > 0 && (
              <span className="text-red-300"> · {agent.failedRuns24h} failed</span>
            )}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="mono-label text-muted-foreground">Action budget today</dt>
          <dd className="mt-1.5">
            <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full",
                  budgetUsed >= 1 ? "bg-amber-400" : "bg-rose",
                )}
                style={{ width: `${Math.min(100, budgetUsed * 100)}%` }}
              />
            </div>
            <span className="mono-figure mt-1 block text-[0.7rem] text-muted-foreground">
              {agent.actionsToday} / {agent.dailyActionBudget}
            </span>
          </dd>
        </div>
      </dl>

      {agent.lastError && (
        <p className="rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs leading-relaxed text-red-200">
          {agent.lastError}
        </p>
      )}

      <div className="mt-auto space-y-3">
        <label className="block">
          <span className="mono-label mb-1.5 block text-muted-foreground">Autonomy</span>
          <select
            value={agent.autonomy}
            onChange={(event) =>
              onUpdate(agent.agentKey, { autonomy: event.target.value as ControlPlaneAutonomy })
            }
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {AUTONOMY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {AUTONOMY_OPTIONS.find((option) => option.value === agent.autonomy)?.hint}
          {agent.autonomy === "autonomous" && " High-risk decisions still wait for you."}
        </p>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onRun(agent.agentKey)}
            disabled={busy || !agent.enabled}
            className="flex-1"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Zap />}
            Run now
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onUpdate(agent.agentKey, { enabled: !agent.enabled })}
            aria-label={agent.enabled ? `Pause ${agent.displayName}` : `Resume ${agent.displayName}`}
          >
            {agent.enabled ? <Pause /> : <Play />}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mono-label text-muted-foreground underline-offset-4 hover:underline"
        >
          {expanded ? "Hide schedule" : "Schedule"}
        </button>
        {expanded && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Runs every {agent.intervalMinutes} minutes.
            {agent.nextRunAt ? ` Next due ${formatRelative(agent.nextRunAt)}.` : " Next run unscheduled."}
          </p>
        )}
      </div>
    </article>
  );
}
