import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetControlGrowth,
  getGetControlGrowthQueryKey,
  getGetControlOverviewQueryKey,
  useRecomputeControlGrowth,
  useUpdateControlCopyVariant,
  useResetControlDeliverabilityGuard,
  useGenerateControlDigest,
  useListControlExperiments,
  getListControlExperimentsQueryKey,
  type ControlAdaptation,
  type ControlGrowthResponse,
  type GrowthSegmentStat,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";
import { FunnelBars } from "./Charts";
import { ExperimentCard } from "./ExperimentsTab";
import { count, day, hours, money, pct, ratio } from "./format";

/*
 * Growth loop (growth-loop.md 13.1): outcome KPIs from the latest snapshot,
 * the activation funnel and weekly cohorts, outbound by segment, copy
 * variants, the experiment board, adaptation history and the weekly digest.
 * Copy rules: plain words, every rate with its denominator, "—" for unknown.
 */

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="mono-label text-muted-foreground">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <Card className="p-4">
      <p className="mono-label text-muted-foreground">{label}</p>
      <div className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</p>
    </Card>
  );
}

const th = "py-1.5 pr-3 font-normal whitespace-nowrap";
const td = "py-1.5 pr-3 whitespace-nowrap";

function DeliverabilityBanner({ growth }: { growth: ControlGrowthResponse }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const reset = useResetControlDeliverabilityGuard({
    mutation: {
      onSuccess: () => {
        toast({ title: "Guard reset" });
        setNote("");
        void queryClient.invalidateQueries({ queryKey: getGetControlGrowthQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Guard not reset", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const { status, guard } = growth.kpis.deliverability;
  if (status === "ok" || status === "insufficient_data") return null;
  const resettable = status === "paused" || status === "throttled";
  return (
    <Card className={cn("flex flex-wrap items-center justify-between gap-3 p-4", status === "paused" ? "border-danger/40" : "border-warning/50")}>
      <p className={cn("text-sm", status === "paused" ? "text-danger" : "text-warning")}>
        Deliverability {status}
        {guard.reason ? `: ${guard.reason}` : ""}. Sending {guard.effectiveCap}/{guard.baseCap} per day.
      </p>
      {resettable ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why it is safe to resume (required)"
            aria-label="Reset note"
            maxLength={400}
            className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <ActionButton
            tone="danger"
            disabled={note.trim().length < 5 || reset.isPending}
            onClick={() => reset.mutate({ data: { note: note.trim() } })}
          >
            Reset guard
          </ActionButton>
        </div>
      ) : null}
    </Card>
  );
}

function SegmentTable({ rows }: { rows: GrowthSegmentStat[] }) {
  if (rows.length === 0) {
    return <EmptyState text="No outreach sent yet. Segment rates appear once studio emails go out." />;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card px-4 py-2">
      <table className="w-full min-w-[44rem] text-left text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className={th}>Segment</th>
            <th className={th}>Prospects</th>
            <th className={th}>Sent</th>
            <th className={th}>Delivered</th>
            <th className={th}>Replied (positive)</th>
            <th className={th}>Signups</th>
            <th className={th}>Paid</th>
            <th className={th}>Reply %</th>
            <th className={th}>Signup %</th>
            <th className={th}>Guidance</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((row) => (
            <tr key={`${row.segmentType}:${row.segment}`} className="border-b border-border/60">
              <td className={cn(td, "text-foreground")}>{row.segment}</td>
              <td className={td}>{count(row.prospects)}</td>
              <td className={td}>{count(row.sent)}</td>
              <td className={td}>{count(row.delivered)}</td>
              <td className={td}>
                {count(row.replied)} ({count(row.positiveReplied)})
              </td>
              <td className={td}>{count(row.signups)}</td>
              <td className={td}>{count(row.paid)}</td>
              <td className={td}>{pct(row.replyRate)}</td>
              <td className={td}>{pct(row.signupRate)}</td>
              <td className={td}>{row.guidance ? <Pill value={row.guidance} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VariantsTable({ growth }: { growth: ControlGrowthResponse }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateControlCopyVariant({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${data.variant.name} ${data.variant.active ? "resumed" : "paused"}` });
        void queryClient.invalidateQueries({ queryKey: getGetControlGrowthQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Variant not changed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  if (growth.variants.length === 0) return <EmptyState text="No copy variants registered yet." />;
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-card px-4 py-2">
        <table className="w-full min-w-[40rem] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className={th}>Variant</th>
              <th className={th}>Active</th>
              <th className={th}>Weight</th>
              <th className={th}>Sent</th>
              <th className={th}>Delivered</th>
              <th className={th}>Positive reply</th>
              <th className={th}>Signup</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {growth.variants.map((variant) => (
              <tr key={variant.variantKey} className="border-b border-border/60">
                <td className={cn(td, "text-foreground")}>
                  {variant.name} <span className="font-mono text-[11px] text-muted-foreground">{variant.variantKey}</span>
                  {variant.isControl ? <Pill value="control" className="ml-2" /> : null}
                </td>
                <td className={td}>
                  <ActionButton
                    tone="neutral"
                    disabled={variant.isControl || update.isPending}
                    title={variant.isControl ? "The control always stays on" : undefined}
                    onClick={() => update.mutate({ key: variant.variantKey, data: { active: !variant.active } })}
                  >
                    {variant.active ? "Pause" : "Resume"}
                  </ActionButton>
                </td>
                <td className={td}>{pct(variant.weight, 0)}</td>
                <td className={td}>{count(variant.sent)}</td>
                <td className={td}>{count(variant.delivered)}</td>
                <td className={td}>
                  {pct(variant.positiveReplyRate)} <span className="text-muted-foreground">({ratio(variant.positiveReplied, variant.delivered)})</span>
                </td>
                <td className={td}>{pct(variant.signupRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Weights are set by the adaptation rules from smoothed positive-reply rates; the control always keeps at least 20%.
      </p>
    </div>
  );
}

function AdaptationRow({ adaptation }: { adaptation: ControlAdaptation }) {
  const [open, setOpen] = useState(false);
  const hasDetail = adaptation.before != null || adaptation.after != null;
  return (
    <li className="py-2 text-xs">
      <button
        type="button"
        disabled={!hasDetail}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-2 text-left disabled:cursor-default"
      >
        <span className="text-foreground/90">
          <span className="mono-label mr-2 text-muted-foreground">{fmt(adaptation.createdAt)}</span>
          {adaptation.ruleKey.replace(/_/g, " ")} · {adaptation.action.replace(/_/g, " ")} · {adaptation.reason}
        </span>
        {hasDetail ? open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : null}
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-2 text-[11px]">
            before {JSON.stringify(adaptation.before, null, 2)}
          </pre>
          <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-2 text-[11px]">
            after {JSON.stringify(adaptation.after, null, 2)}
          </pre>
        </div>
      ) : null}
    </li>
  );
}

const RECOMMENDATION_TONE: Record<string, string> = { scale: "primary", kill: "danger", fix: "warning", watch: "neutral" };

function DigestSection({ growth }: { growth: ControlGrowthResponse }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const generate = useGenerateControlDigest({
    mutation: {
      onSuccess: () => {
        toast({ title: "Digest generated" });
        void queryClient.invalidateQueries({ queryKey: getGetControlGrowthQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Digest not generated", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const digest = growth.latestDigest;
  const doc = (digest?.document ?? {}) as Record<string, unknown>;
  const headline = typeof doc.headline === "string" ? doc.headline : null;
  const recommendations = Array.isArray(doc.recommendations)
    ? (doc.recommendations as Array<Record<string, unknown>>).filter((r) => r && typeof r === "object")
    : [];
  return (
    <Section
      title={digest ? `Weekly digest · week of ${day(digest.weekStart)}` : "Weekly digest"}
      aside={
        <div className="flex items-center gap-2">
          {digest ? <Pill value={digest.sentAt ? "sent" : digest.actionId ? "queued" : "draft"} /> : null}
          <ActionButton tone="neutral" disabled={generate.isPending} onClick={() => generate.mutate({ data: { force: true } })}>
            {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Generate now
          </ActionButton>
        </div>
      }
    >
      {!digest ? (
        <EmptyState text="No digest yet. One is built each week from the latest snapshot; generate one now to preview it." />
      ) : (
        <Card className="space-y-3">
          {headline ? <p className="font-display text-lg text-foreground">{headline}</p> : null}
          {recommendations.length > 0 ? (
            <ul className="space-y-1.5">
              {recommendations.map((rec, index) => {
                const kind = typeof rec.kind === "string" ? rec.kind : "watch";
                const text =
                  typeof rec.text === "string" ? rec.text : typeof rec.title === "string" ? rec.title : JSON.stringify(rec);
                return (
                  <li key={index} className="flex gap-2 text-xs leading-relaxed text-foreground/90" data-tone={RECOMMENDATION_TONE[kind] ?? "neutral"}>
                    <Pill value={kind} className="shrink-0" />
                    <span>{text}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {digest.html ? (
            <iframe
              title="Digest preview"
              sandbox=""
              srcDoc={digest.html}
              className="h-[640px] w-full rounded-md border border-border bg-white"
            />
          ) : null}
          {digest.sentTo && digest.sentTo.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Sent to {digest.sentTo.join(", ")} · {fmt(digest.sentAt)}
            </p>
          ) : null}
        </Card>
      )}
    </Section>
  );
}

function ExperimentBoard({ growth }: { growth: ControlGrowthResponse }) {
  const [showDecided, setShowDecided] = useState(false);
  const experimentsQuery = useListControlExperiments(
    {},
    { query: { queryKey: getListControlExperimentsQueryKey(), refetchInterval: 60000 } },
  );
  const experiments = experimentsQuery.data?.experiments ?? [];
  const live = experiments
    .filter((e) => e.status === "running" || e.status === "proposed")
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "running" ? -1 : 1));
  const decided = experiments.filter((e) => e.status !== "running" && e.status !== "proposed");
  const { kpis } = growth;
  return (
    <Section
      title="Experiment board"
      aside={
        <span className="mono-label text-muted-foreground">
          {kpis.experiments.running} running · {kpis.experiments.proposed} proposed · {kpis.experiments.decisionsDue7d} decisions due in 7d
        </span>
      }
    >
      {experimentsQuery.isLoading ? (
        <TabLoading />
      ) : live.length === 0 ? (
        <EmptyState text="Nothing running or proposed. Add one in the Experiments tab or let the experiments agent propose one." />
      ) : (
        live.map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} metricKeys={growth.metricKeys} />)
      )}
      {decided.length > 0 ? (
        <div className="space-y-3">
          <ActionButton tone="neutral" onClick={() => setShowDecided((v) => !v)}>
            {showDecided ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Decided ({decided.length})
          </ActionButton>
          {showDecided
            ? decided.map((experiment) => <ExperimentCard key={experiment.id} experiment={experiment} metricKeys={growth.metricKeys} />)
            : null}
        </div>
      ) : null}
    </Section>
  );
}

export function GrowthTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [segmentType, setSegmentType] = useState<"region" | "venue_type">("region");
  const growthQuery = useGetControlGrowth({
    query: { queryKey: getGetControlGrowthQueryKey(), refetchInterval: 60000, retry: 1 },
  });
  const recompute = useRecomputeControlGrowth({
    mutation: {
      onSuccess: () => {
        toast({ title: "Snapshot taken" });
        void queryClient.invalidateQueries({ queryKey: getGetControlGrowthQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Recompute failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });

  if (growthQuery.isLoading) return <TabLoading />;
  const growth = growthQuery.data;
  if (!growth) {
    return <EmptyState text={`Growth KPIs are unavailable: ${apiErrorMessage(growthQuery.error)}`} />;
  }
  const { kpis } = growth;
  const { activation, trialToPaid, revenue, outbound, deliverability, signups } = kpis;
  const funnel = activation.funnel;
  const cohorts = [...activation.byCohortWeek].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 12);
  const paidByWeek = new Map(trialToPaid.byCohortWeek.map((row) => [row.weekStart, row]));
  const segments = outbound.bySegment.filter((row) => row.segmentType === segmentType);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="mono-label flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>Growth loop</span>
          <span>Snapshot {fmt(growth.computedAt)}</span>
          <Pill value={growth.loopEnabled ? "loop on" : "loop off"} className={growth.loopEnabled ? "text-success" : "text-warning"} />
        </p>
        <ActionButton tone="neutral" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
          <RefreshCw className={cn("h-3 w-3", recompute.isPending && "animate-spin")} />
          Recompute now
        </ActionButton>
      </div>

      <DeliverabilityBanner growth={growth} />

      {kpis.dataQuality.length > 0 ? (
        <ul className="space-y-1">
          {kpis.dataQuality.map((line) => (
            <li key={line} className="flex gap-2 text-xs text-warning">
              <span aria-hidden>▲</span>
              {line}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Signups 7d"
          value={count(signups.orgs7d)}
          sub={`${signups.orgs30d} in 30d · ${signups.attributedToOutbound30d} from outreach`}
        />
        <Kpi
          label="First gallery"
          value={pct(activation.rates.firstGallery)}
          sub={`median ${hours(activation.timeToFirstGalleryHours.median)} to first gallery`}
        />
        <Kpi
          label="Trial → paid"
          value={pct(trialToPaid.overall.rate)}
          sub={`${ratio(trialToPaid.overall.paid, trialToPaid.overall.orgs)} matured · activated ${pct(trialToPaid.byActivation.activated.rate)}`}
        />
        <Kpi
          label="MRR est."
          value={money(revenue.mrrCents)}
          sub={`${revenue.subscriptionOrgs} subs · ${revenue.paidOrgs} paid · prices from ${revenue.prices.source}`}
        />
        <Kpi
          label="Positive replies"
          value={pct(outbound.rates.positiveReplyRate)}
          sub={`${ratio(outbound.funnel.positiveReplied, outbound.funnel.delivered)} delivered · ${outbound.funnel.signups} signups`}
        />
        <Kpi
          label="Deliverability"
          value={<Pill value={deliverability.status} className="text-sm" />}
          sub={`bounce ${pct(deliverability.window14d.bounceRate, 2)} · complaints ${pct(deliverability.window14d.complaintRate, 3)}`}
        />
      </div>

      <Section title="Activation funnel">
        <Card className="p-4">
          <FunnelBars
            title={`Organizations created since ${day(kpis.window.cohortStart)}`}
            stages={[
              { label: "Organizations", value: funnel.orgs },
              { label: "With a venue", value: funnel.withVenue },
              { label: `Photos ready (≥${activation.minPhotos})`, value: funnel.photosReady },
              { label: "First gallery", value: funnel.firstGallery },
              { label: "Gallery viewed", value: funnel.galleryViewed },
              { label: "Second gallery ≤14d", value: funnel.secondGallery14d },
            ]}
            caption={`Within 7 days: ${pct(activation.firstGalleryWithin7d)} · within 14 days: ${pct(activation.firstGalleryWithin14d)}`}
          />
        </Card>
      </Section>

      <Section title="Weekly cohorts">
        {cohorts.length === 0 ? (
          <EmptyState text="No signup cohorts yet." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card px-4 py-2">
            <table className="w-full min-w-[40rem] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className={th}>Week</th>
                  <th className={th}>Signups</th>
                  <th className={th}>Photos ready</th>
                  <th className={th}>First gallery</th>
                  <th className={th}>Viewed</th>
                  <th className={th}>2nd ≤14d</th>
                  <th className={th}>Paid</th>
                  <th className={th}>Paid %</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {cohorts.map((row) => {
                  const paid = paidByWeek.get(row.weekStart);
                  return (
                    <tr key={row.weekStart} className="border-b border-border/60">
                      <td className={cn(td, "text-foreground")}>{day(row.weekStart)}</td>
                      <td className={td}>{row.orgs}</td>
                      <td className={td}>{row.photosReady}</td>
                      <td className={td}>{row.firstGallery}</td>
                      <td className={td}>{row.galleryViewed}</td>
                      <td className={td}>{row.secondGallery14d}</td>
                      <td className={td}>{row.paid}</td>
                      <td className={td} title={row.matured ? undefined : "cohort still inside the trial window"}>
                        {row.matured ? pct(paid?.rate ?? (row.orgs > 0 ? row.paid / row.orgs : null), 0) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        title="Outbound by segment"
        aside={
          <div className="flex gap-1.5" role="group" aria-label="Segment type">
            {(["region", "venue_type"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={segmentType === value}
                onClick={() => setSegmentType(value)}
                className={cn(
                  "mono-label h-8 rounded-md border px-3 transition-colors",
                  segmentType === value ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "region" ? "Region" : "Venue type"}
              </button>
            ))}
          </div>
        }
      >
        <SegmentTable rows={segments} />
      </Section>

      <Section title="Copy variants">
        <VariantsTable growth={growth} />
      </Section>

      <ExperimentBoard growth={growth} />

      <Section title={`Adaptations (last ${growth.adaptations.length})`}>
        {growth.adaptations.length === 0 ? (
          <EmptyState text="No adaptation rule has fired yet. Rules act only once enough sends or signups exist to be meaningful." />
        ) : (
          <Card className="py-2">
            <ul className="divide-y divide-border/60">
              {growth.adaptations.map((adaptation) => (
                <AdaptationRow key={adaptation.id} adaptation={adaptation} />
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <DigestSection growth={growth} />
    </div>
  );
}
