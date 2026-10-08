import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetControlOverviewQueryKey,
  useListControlTasks,
  getListControlTasksQueryKey,
  useSetControlTaskStatus,
  type ControlTask,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

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

export function TasksTab() {
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
              "mono-label h-8 rounded-md border px-3 transition-colors",
              filter === value
                ? "border-primary text-foreground"
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
