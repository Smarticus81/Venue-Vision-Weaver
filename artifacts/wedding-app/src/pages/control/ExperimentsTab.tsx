import {
  useListControlExperiments,
  getListControlExperimentsQueryKey,
} from "@workspace/api-client-react";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

/* ————— Experiments ————— */

export function ExperimentsTab() {
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
