import { useQueryClient } from "@tanstack/react-query";
import {
  getGetControlOverviewQueryKey,
  useRunControlAgent,
  useSetControlAgentStatus,
  getListControlRunsQueryKey,
  type ControlAgent,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2, Play, Pause } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

/* ————— Agents fleet ————— */

export function AgentCard({
  agent,
  aiConfigured,
  fleetPaused = false,
}: {
  agent: ControlAgent;
  aiConfigured: boolean;
  fleetPaused?: boolean;
}) {
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
        <Pill value={fleetPaused ? "paused" : agent.status} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="text-xs text-muted-foreground">
          <p>
            Last run {fmt(agent.lastRunAt)}
            {agent.lastRunStatus ? ` (${agent.lastRunStatus})` : ""}
          </p>
          <p>
            Every {Math.round(agent.intervalMinutes / 60)}h
            {fleetPaused && agent.status === "active" ? " · held by the kill switch" : ""}
          </p>
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
            disabled={runAgent.isPending || !aiConfigured || fleetPaused}
            title={fleetPaused ? "All agents are paused by the kill switch" : undefined}
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

/* The fleet grid rendered inside the Overview tab (markup moved verbatim from ControlConsole). */
export function AgentsTab({
  agents,
  aiConfigured,
  fleetPaused = false,
}: {
  agents: ControlAgent[];
  aiConfigured: boolean;
  fleetPaused?: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {agents.map((agent) => (
        <AgentCard key={agent.key} agent={agent} aiConfigured={aiConfigured} fleetPaused={fleetPaused} />
      ))}
    </div>
  );
}
