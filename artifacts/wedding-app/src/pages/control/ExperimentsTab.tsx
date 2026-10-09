import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListControlExperiments,
  getListControlExperimentsQueryKey,
  useGetControlGrowth,
  getGetControlGrowthQueryKey,
  useCreateControlExperiment,
  useUpdateControlExperiment,
  useEvaluateControlExperiment,
  useDecideControlExperiment,
  getGetControlOverviewQueryKey,
  type ControlExperiment,
  type ControlExperimentDecisionBodyDecision,
  type ControlMetricKey,
  type GrowthVariantStat,
  type ListControlExperimentsParams,
  type ListControlExperimentsStatus,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";
import { count, hours, money, pct } from "./format";

/* ————— Experiments: typed cards (metric, baseline → target, observed, decision) ————— */

/** Format a metric value by its registry unit. */
export function metricValue(value: number | null | undefined, unit: ControlMetricKey["unit"] | undefined): string {
  switch (unit) {
    case "rate":
      return pct(value, 1);
    case "hours":
      return hours(value);
    case "cents":
      return money(value);
    default:
      return count(value);
  }
}

/**
 * The value an experiment must reach to win: baseline moved by the minimum
 * detectable lift in the metric's good direction. Null when either is unknown.
 */
export function experimentTarget(
  baseline: number | null | undefined,
  lift: number | null | undefined,
  direction: "higher" | "lower" | undefined,
): number | null {
  if (baseline == null || lift == null || !Number.isFinite(baseline) || !Number.isFinite(lift)) return null;
  return direction === "lower" ? baseline * (1 - lift) : baseline * (1 + lift);
}

function evaluationOf(experiment: ControlExperiment) {
  const raw = experiment.evaluation as Record<string, unknown> | null | undefined;
  if (!raw) return null;
  return {
    decision: typeof raw.decision === "string" ? raw.decision : null,
    reason: typeof raw.reason === "string" ? raw.reason : null,
    n: typeof raw.n === "number" ? raw.n : null,
    target: typeof raw.target === "number" ? raw.target : null,
    requiredN: typeof raw.requiredN === "number" ? raw.requiredN : null,
    underpowered: raw.underpowered === true,
    evaluatedAt: typeof raw.evaluatedAt === "string" ? raw.evaluatedAt : null,
  };
}

function useExperimentInvalidation() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: getListControlExperimentsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetControlGrowthQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
  };
}

export function ExperimentCard({ experiment, metricKeys }: { experiment: ControlExperiment; metricKeys: ControlMetricKey[] }) {
  const { toast } = useToast();
  const invalidate = useExperimentInvalidation();
  const [note, setNote] = useState("");
  const metric = metricKeys.find((m) => m.key === experiment.primaryMetricKey);
  const evaluation = evaluationOf(experiment);
  const target =
    evaluation?.target ?? experimentTarget(experiment.baseline, experiment.minDetectableLift, metric?.direction);
  const onError = (title: string) => (err: ErrorType<ErrorEnvelope>) =>
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });

  const evaluate = useEvaluateControlExperiment({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `Evaluation: ${data.evaluation.decision.replace(/_/g, " ")}`, description: data.evaluation.reason });
        invalidate();
      },
      onError: onError("Evaluation failed"),
    },
  });
  const decide = useDecideControlExperiment({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${data.experiment.name}: ${data.experiment.decision ?? data.experiment.status}` });
        setNote("");
        invalidate();
      },
      onError: onError("Decision failed"),
    },
  });
  const start = useUpdateControlExperiment({
    mutation: {
      onSuccess: () => {
        toast({ title: `${experiment.name} started` });
        invalidate();
      },
      onError: onError("Could not start"),
    },
  });

  const running = experiment.status === "running";
  const busy = evaluate.isPending || decide.isPending || start.isPending;
  const decideWith = (decision: ControlExperimentDecisionBodyDecision) => {
    const base = Math.max(Date.now(), experiment.decisionDate ? new Date(experiment.decisionDate).getTime() : 0);
    decide.mutate({
      id: experiment.id,
      data: {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(decision === "extended" ? { newDecisionDate: new Date(base + 14 * 86_400_000).toISOString() } : {}),
      },
    });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Pill value={experiment.status} />
          {experiment.decision ? <Pill value={experiment.decision} /> : null}
          <span className="text-sm font-medium text-foreground">{experiment.name}</span>
        </div>
        <span className="mono-label text-muted-foreground">
          {experiment.createdByAgent ?? "operator"} · {fmt(experiment.createdAt)}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        <span className="text-foreground/70">Hypothesis:</span> {experiment.hypothesis}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-4">
          <dt className="mono-label text-muted-foreground">Metric</dt>
          <dd className="text-foreground">
            {metric?.label ?? experiment.primaryMetricKey ?? experiment.metric}
            {experiment.primaryMetricKey ? (
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">{experiment.primaryMetricKey}</span>
            ) : (
              <span className="ml-2 text-warning">no metric key: the evaluator cannot read this one</span>
            )}
            {metric ? <span className="ml-2 text-muted-foreground">({metric.direction} is better)</span> : null}
          </dd>
        </div>
        <div>
          <dt className="mono-label text-muted-foreground">Baseline</dt>
          <dd className="tabular-nums text-foreground">{metricValue(experiment.baseline, metric?.unit)}</dd>
        </div>
        <div>
          <dt className="mono-label text-muted-foreground">Current</dt>
          <dd className="tabular-nums text-foreground">
            {metricValue(experiment.observedValue, metric?.unit)}
            {experiment.observedN != null ? <span className="text-muted-foreground"> · n={experiment.observedN}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="mono-label text-muted-foreground">Target</dt>
          <dd className="tabular-nums text-foreground">
            {metricValue(target, metric?.unit)}
            {experiment.minDetectableLift != null ? (
              <span className="text-muted-foreground"> · lift {pct(experiment.minDetectableLift, 0)}</span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="mono-label text-muted-foreground">Decision date</dt>
          <dd className="text-foreground">{fmt(experiment.decisionDate)}</dd>
        </div>
        {experiment.segment || experiment.variantKey ? (
          <div className="col-span-2 sm:col-span-4 text-muted-foreground">
            {experiment.segment ? `segment ${experiment.segment}` : ""}
            {experiment.segment && experiment.variantKey ? " · " : ""}
            {experiment.variantKey ? `variant ${experiment.variantKey}` : ""}
          </div>
        ) : null}
      </dl>
      {evaluation?.reason ? (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          <span className="mono-label mr-2">Last evaluation</span>
          {evaluation.decision ? `${evaluation.decision.replace(/_/g, " ")}: ` : ""}
          {evaluation.reason}
          {evaluation.underpowered ? ` · underpowered${evaluation.requiredN ? ` (needs n=${evaluation.requiredN})` : ""}` : ""}
          {evaluation.evaluatedAt ? ` · ${fmt(evaluation.evaluatedAt)}` : ""}
        </p>
      ) : null}
      {experiment.result ? (
        <p className="mt-2 text-xs leading-relaxed text-foreground/85">
          <span className="mono-label mr-2 text-muted-foreground">Readout</span>
          {experiment.result}
        </p>
      ) : null}
      {experiment.decidedBy ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Decided by {experiment.decidedBy} · {fmt(experiment.decidedAt)}
        </p>
      ) : null}
      {running || experiment.status === "proposed" ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          {running ? (
            <>
              <ActionButton tone="neutral" disabled={busy} onClick={() => evaluate.mutate({ id: experiment.id })}>
                {evaluate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Evaluate now
              </ActionButton>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Decision note"
                aria-label="Decision note"
                maxLength={1000}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <ActionButton tone="neutral" disabled={busy} onClick={() => decideWith("win")}>
                Win
              </ActionButton>
              <ActionButton tone="danger" disabled={busy} onClick={() => decideWith("kill")}>
                Kill
              </ActionButton>
              <ActionButton tone="neutral" disabled={busy} onClick={() => decideWith("inconclusive")}>
                Inconclusive
              </ActionButton>
              <ActionButton tone="neutral" disabled={busy} onClick={() => decideWith("extended")}>
                Extend 14d
              </ActionButton>
            </>
          ) : (
            <ActionButton
              tone="neutral"
              disabled={busy || !experiment.primaryMetricKey}
              title={experiment.primaryMetricKey ? "Start measuring now" : "Give it a metric key first"}
              onClick={() => start.mutate({ id: experiment.id, data: { status: "running" } })}
            >
              {start.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Start
            </ActionButton>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function NewExperimentForm({
  metricKeys,
  variants,
  onDone,
}: {
  metricKeys: ControlMetricKey[];
  variants: GrowthVariantStat[];
  onDone: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useExperimentInvalidation();
  const defaultDate = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    name: "",
    hypothesis: "",
    metric: "",
    primaryMetricKey: metricKeys[0]?.key ?? "",
    segment: "",
    variantKey: "",
    baseline: "",
    minDetectableLift: "0.25",
    killThreshold: "",
    decisionDate: defaultDate,
    startNow: false,
  });
  const create = useCreateControlExperiment({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `Experiment #${data.experiment.id} created` });
        invalidate();
        onDone();
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Experiment not created", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const metric = metricKeys.find((m) => m.key === form.primaryMetricKey);
  const set = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));
  const num = (raw: string) => (raw.trim() === "" ? null : Number(raw));
  const input =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const valid =
    form.name.trim().length >= 3 &&
    form.hypothesis.trim().length >= 10 &&
    form.metric.trim().length >= 3 &&
    form.primaryMetricKey !== "" &&
    Number(form.minDetectableLift) > 0;

  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Name</span>
          <input value={form.name} onChange={set("name")} maxLength={120} className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Metric (plain words)</span>
          <input value={form.metric} onChange={set("metric")} maxLength={200} placeholder="Positive replies per delivered email" className={input} />
        </label>
        <label className="space-y-1 text-xs sm:col-span-2">
          <span className="text-muted-foreground">Hypothesis</span>
          <textarea value={form.hypothesis} onChange={set("hypothesis")} rows={3} maxLength={1000} className={cn(input, "h-auto py-1.5")} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">
            Primary metric{metric ? ` (${metric.unit}, ${metric.direction} is better)` : ""}
          </span>
          <select value={form.primaryMetricKey} onChange={set("primaryMetricKey")} className={input}>
            {metricKeys.length === 0 ? <option value="">No metric keys loaded</option> : null}
            {metricKeys.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Variant (optional)</span>
          <select value={form.variantKey} onChange={set("variantKey")} className={input}>
            <option value="">None</option>
            {variants.map((v) => (
              <option key={v.variantKey} value={v.variantKey}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Segment (optional)</span>
          <input value={form.segment} onChange={set("segment")} placeholder="region:Hill Country" className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Baseline</span>
          <input value={form.baseline} onChange={set("baseline")} inputMode="decimal" placeholder="auto from latest snapshot" className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Minimum lift worth acting on (0.25 = +25%)</span>
          <input value={form.minDetectableLift} onChange={set("minDetectableLift")} inputMode="decimal" className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Kill threshold (optional)</span>
          <input value={form.killThreshold} onChange={set("killThreshold")} inputMode="decimal" className={input} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="text-muted-foreground">Decision date</span>
          <input type="date" value={form.decisionDate} onChange={set("decisionDate")} className={input} />
        </label>
        <label className="flex items-center gap-2 self-end text-xs text-foreground">
          <input
            type="checkbox"
            checked={form.startNow}
            onChange={(e) => setForm((f) => ({ ...f, startNow: e.target.checked }))}
            className="accent-current"
          />
          Start now
        </label>
      </div>
      <div className="flex justify-end gap-1.5">
        <ActionButton tone="neutral" onClick={onDone}>
          Cancel
        </ActionButton>
        <ActionButton
          tone="primary"
          disabled={!valid || create.isPending}
          onClick={() =>
            create.mutate({
              data: {
                name: form.name.trim(),
                hypothesis: form.hypothesis.trim(),
                metric: form.metric.trim(),
                primaryMetricKey: form.primaryMetricKey,
                segment: form.segment.trim() || null,
                variantKey: form.variantKey || null,
                baseline: num(form.baseline),
                minDetectableLift: Number(form.minDetectableLift),
                killThreshold: num(form.killThreshold),
                decisionDate: new Date(`${form.decisionDate}T12:00:00Z`).toISOString(),
                startNow: form.startNow,
              },
            })
          }
        >
          {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Create experiment
        </ActionButton>
      </div>
    </Card>
  );
}

const STATUS_FILTERS = ["all", "running", "proposed", "completed", "aborted"] as const;

export function ExperimentsTab() {
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const params: ListControlExperimentsParams = status === "all" ? {} : { status: status as ListControlExperimentsStatus };
  const experimentsQuery = useListControlExperiments(params, {
    query: { queryKey: getListControlExperimentsQueryKey(params) },
  });
  const growthQuery = useGetControlGrowth({ query: { queryKey: getGetControlGrowthQueryKey(), retry: false } });
  const metricKeys = growthQuery.data?.metricKeys ?? [];
  const variants = growthQuery.data?.variants ?? [];
  const experiments = experimentsQuery.data?.experiments ?? [];
  const order = (e: ControlExperiment) => (e.status === "running" ? 0 : e.status === "proposed" ? 1 : 2);
  const sorted = [...experiments].sort((a, b) => order(a) - order(b));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              className={cn(
                "mono-label h-8 rounded-md border px-3 transition-colors",
                status === value ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {value}
            </button>
          ))}
        </div>
        <ActionButton tone="neutral" onClick={() => setCreating((v) => !v)}>
          <Plus className="h-3 w-3" />
          New experiment
        </ActionButton>
      </div>
      {creating ? <NewExperimentForm metricKeys={metricKeys} variants={variants} onDone={() => setCreating(false)} /> : null}
      {experimentsQuery.isLoading ? (
        <TabLoading />
      ) : sorted.length === 0 ? (
        <EmptyState text="No experiments here. The experiments agent registers hypotheses with a metric, baseline, target and decision date; the evaluator reads them against live KPIs. You can add one by hand too." />
      ) : (
        sorted.map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} metricKeys={metricKeys} />)
      )}
    </div>
  );
}
