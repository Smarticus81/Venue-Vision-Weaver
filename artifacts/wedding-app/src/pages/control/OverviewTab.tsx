import { type BusinessMetrics, type ControlOverviewResponse } from "@workspace/api-client-react";
import { Card } from "./shared";
import { AgentsTab } from "./AgentsTab";
import { FunnelBars, StatTile, TrendTable, type TrendPoint } from "./Charts";
import { PolicyCards, policyBoolean, usePolicies } from "./Policies";
import { byUnit, count, pctPoints, ratio, type TrendUnit } from "./format";

/* ————— Overview extras (served by GET /control/overview; not yet in the OpenAPI shape) ————— */

export interface OverviewFunnel {
  owners: { signups: number; signups30d: number; activated: number; paid: number; churned: number };
  prospects: { total: number; vetted: number; contacted: number; replied: number; converted: number; unsubscribed: number };
}

export interface OverviewTrendSeries {
  key: string;
  label: string;
  unit: TrendUnit;
  betterWhen: "higher" | "lower";
  points: TrendPoint[];
  current: number | null;
  previous7d: number | null;
  delta7d: number | null;
}

export type OverviewWithExtras = ControlOverviewResponse & {
  funnel?: OverviewFunnel | null;
  trends?: { windowDays: number; series: OverviewTrendSeries[] } | null;
};

/* ————— Business pulse (the live KPI wall) ————— */

function MetricBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold text-foreground">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

export function MetricsWall({ metrics }: { metrics: BusinessMetrics }) {
  const subs = metrics.organizations.paidSubscriptionCount;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <MetricBlock
        label="Organizations"
        value={count(metrics.organizations.total)}
        sub={`${metrics.organizations.paidCount} paid${subs != null ? ` (${subs} subscriptions)` : ""}, ${metrics.organizations.lowCreditCount} low on credits`}
      />
      <MetricBlock label="Venues" value={count(metrics.venues.total)} sub={`${metrics.venues.new30d} new in 30d`} />
      <MetricBlock
        label="Sessions 7d"
        value={count(metrics.sessions.created7d)}
        sub={`${metrics.sessions.ready7d} ready, ${metrics.sessions.failed7d} failed`}
      />
      <MetricBlock
        label="Failure rate 7d"
        value={pctPoints(metrics.sessions.failureRate7d)}
        sub={
          metrics.sessions.avgCompletionMinutes7d != null
            ? `avg completion ${metrics.sessions.avgCompletionMinutes7d} min`
            : undefined
        }
      />
      <MetricBlock
        label="Credits consumed 30d"
        value={count(metrics.credits.consumed30d)}
        sub={`${metrics.credits.purchased30d} purchased`}
      />
      <MetricBlock label="Credit float" value={count(metrics.organizations.totalCreditsBalance)} sub="unspent credits across orgs" />
      <MetricBlock label="Assets generated 7d" value={count(metrics.assets.generated7d)} sub={`${metrics.sessions.total} sessions all-time`} />
      <MetricBlock
        label="Venues with photos"
        value={count(metrics.venues.withMedia)}
        sub={`${metrics.venues.withSessions} with a gallery`}
      />
    </div>
  );
}

/* ————— Revenue funnel row ————— */

export function RevenueFunnel({ funnel }: { funnel: OverviewFunnel }) {
  const { owners, prospects } = funnel;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4">
        <FunnelBars
          title="Venue owners"
          stages={[
            { label: "Signups", value: owners.signups },
            { label: "Activated", value: owners.activated },
            { label: "Paid", value: owners.paid },
            { label: "Churned", value: owners.churned, basis: owners.paid, basisLabel: "paid" },
          ]}
          caption={`Activated = at least one couple gallery ready. Paid = a subscription or credit pack. ${owners.signups30d} signups in the last 30 days.`}
        />
      </Card>
      <Card className="p-4">
        <FunnelBars
          title="Outreach prospects"
          stages={[
            { label: "Prospects", value: prospects.total },
            { label: "Vetted", value: prospects.vetted },
            { label: "Contacted", value: prospects.contacted },
            { label: "Replied", value: prospects.replied },
            { label: "Converted", value: prospects.converted },
          ]}
          caption={`Vetted = legitimacy checks passed. ${prospects.unsubscribed} unsubscribed.`}
        />
      </Card>
    </div>
  );
}

/* ————— KPI trends ————— */

const TILE_ORDER = ["mrr", "paid", "organizations", "activation", "sessions7d", "bounceRate"];

function seriesByKey(series: OverviewTrendSeries[], key: string) {
  return series.find((s) => s.key === key);
}

export function TrendTiles({ series, windowDays }: { series: OverviewTrendSeries[]; windowDays: number }) {
  const complaint = seriesByKey(series, "complaintRate");
  const tiles = TILE_ORDER.map((key) => seriesByKey(series, key)).filter((s): s is OverviewTrendSeries => Boolean(s));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {tiles.map((s) => (
          <StatTile
            key={s.key}
            label={s.key === "bounceRate" ? "Deliverability" : s.label}
            value={s.key === "bounceRate" ? `${byUnit(s.current, "rate")} bounced` : byUnit(s.current, s.unit)}
            sub={
              s.key === "bounceRate"
                ? `${byUnit(complaint?.current ?? null, "rate")} complaints · last 14 days`
                : s.key === "mrr"
                  ? "from the latest KPI snapshot"
                  : undefined
            }
            unit={s.unit}
            change={s.delta7d}
            betterWhen={s.betterWhen}
            points={s.points}
          />
        ))}
      </div>
      <details className="rounded-lg border border-border bg-card px-4 py-2 text-xs">
        <summary className="mono-label cursor-pointer text-muted-foreground">
          Show as table · daily values, last {windowDays} days
        </summary>
        <div className="py-2">
          <TrendTable series={series} />
        </div>
      </details>
    </div>
  );
}

/* ————— Overview tab ————— */

export function OverviewTab({ overview }: { overview: OverviewWithExtras }) {
  const policiesQuery = usePolicies();
  const agentsEnabled = policyBoolean(policiesQuery.data?.policies, "agents_enabled");
  const funnel = overview.funnel ?? null;
  const trends = overview.trends ?? null;
  const paidOwners = funnel ? ratio(funnel.owners.paid, funnel.owners.signups) : null;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="mono-label text-muted-foreground">Revenue funnel</h2>
          {paidOwners ? <span className="mono-label text-muted-foreground">{paidOwners} signups paying</span> : null}
        </div>
        {funnel ? (
          <RevenueFunnel funnel={funnel} />
        ) : (
          <Card className="p-4 text-xs text-muted-foreground">The funnel could not be loaded; the rest of the console still works.</Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="mono-label text-muted-foreground">Trends</h2>
          <span className="mono-label text-muted-foreground">daily snapshots · change vs 7 days ago</span>
        </div>
        {trends && trends.series.length > 0 ? (
          <TrendTiles series={trends.series} windowDays={trends.windowDays} />
        ) : (
          <Card className="p-4 text-xs text-muted-foreground">
            No KPI snapshots yet. The scheduler stores one every few hours; trends appear after the second.
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="mono-label text-muted-foreground">Business pulse</h2>
          <span className="mono-label text-muted-foreground">
            {overview.counts.runs24h} runs in 24h · {overview.counts.runningExperiments} experiments running
          </span>
        </div>
        <MetricsWall metrics={overview.metrics} />
      </section>

      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Agent fleet</h2>
        {!agentsEnabled ? (
          <p className="rounded-md border border-warning/50 bg-warning-soft px-3 py-2 text-xs text-warning">
            All agents are paused by the kill switch. No agent starts a run, scheduled or manual, until you resume them in the header.
          </p>
        ) : null}
        <AgentsTab agents={overview.agents} aiConfigured={overview.aiConfigured} fleetPaused={!agentsEnabled} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="mono-label text-muted-foreground">Guardrails</h2>
          <span className="mono-label text-muted-foreground">every change is checked against its bounds and audited</span>
        </div>
        <PolicyCards />
      </section>
    </div>
  );
}
