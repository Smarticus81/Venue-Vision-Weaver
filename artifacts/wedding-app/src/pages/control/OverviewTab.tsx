import {
  type BusinessMetrics,
  type ControlOverviewResponse,
} from "@workspace/api-client-react";
import { Card } from "./shared";
import { AgentsTab } from "./AgentsTab";

/* ————— Overview: KPI wall ————— */

function MetricBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="mono-label text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-3xl font-semibold text-foreground">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  );
}

export function MetricsWall({ metrics }: { metrics: BusinessMetrics }) {
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

/* ————— Overview tab: business pulse + agent fleet (markup moved verbatim from ControlConsole) ————— */

export function OverviewTab({ overview }: { overview: ControlOverviewResponse }) {
  return (
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
        <AgentsTab agents={overview.agents} aiConfigured={overview.aiConfigured} />
      </section>
    </div>
  );
}
