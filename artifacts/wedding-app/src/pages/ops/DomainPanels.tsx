import { useState } from "react";
import { Loader2 } from "lucide-react";
import type {
  ControlPlaneExperiment,
  ControlPlaneLead,
  ControlPlaneTicket,
  ControlPlaneWorkItem,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, formatPercentValue, formatRelative } from "./primitives";

/* ————————————————————————— Support ————————————————————————— */

const PRIORITY_TONE: Record<string, string> = {
  urgent: "text-red-300",
  high: "text-amber-300",
  normal: "text-muted-foreground",
  low: "text-muted-foreground",
};

export function SupportPanel({
  tickets,
  onResolve,
  busyId,
  onOpenTicket,
}: {
  tickets: ControlPlaneTicket[];
  onResolve: (id: number) => void;
  busyId: number | null;
  onOpenTicket: (subject: string, body: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const open = tickets.filter((ticket) => ticket.status === "open" || ticket.status === "pending");

  return (
    <div className="space-y-4">
      <Panel eyebrow="Support" title={`${open.length} open`}>
        {open.length === 0 ? (
          <EmptyState>The inbox is clear.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {open.map((ticket) => (
              <li key={ticket.id} className="rounded-lg border border-card-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("mono-label", PRIORITY_TONE[ticket.priority] ?? "")}>
                    {ticket.priority}
                  </span>
                  <span className="mono-label text-muted-foreground">{ticket.category}</span>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span className="mono-label text-muted-foreground">
                    {formatRelative(ticket.createdAt)}
                  </span>
                </div>
                <h3 className="mt-2 font-display text-base font-medium leading-snug">
                  {ticket.subject}
                </h3>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {ticket.body}
                </p>

                {ticket.aiDraft ? (
                  <div className="mt-3 rounded-md border border-rose/25 bg-rose/5 p-3">
                    <p className="mono-label mb-1.5 text-rose">Drafted reply</p>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                      {ticket.aiDraft}
                    </p>
                  </div>
                ) : (
                  <p className="mono-label mt-3 text-muted-foreground">
                    No draft yet — the support agent writes one on its next run
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onResolve(ticket.id)}
                    disabled={busyId === ticket.id}
                  >
                    {busyId === ticket.id && <Loader2 className="animate-spin" />}
                    Mark resolved
                  </Button>
                  {ticket.requesterEmail && (
                    <span className="text-xs text-muted-foreground">{ticket.requesterEmail}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel eyebrow="Intake" title="Log a request">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!subject.trim() || !body.trim()) return;
            onOpenTicket(subject.trim(), body.trim());
            setSubject("");
            setBody("");
          }}
        >
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="What did they say?"
            rows={4}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" variant="rose" disabled={!subject.trim() || !body.trim()}>
            Open ticket
          </Button>
        </form>
      </Panel>
    </div>
  );
}

/* ————————————————————————— Sales ————————————————————————— */

const STAGE_ORDER = ["new", "qualified", "contacted", "demo", "won", "lost"];

export function SalesPanel({
  leads,
  onCreate,
  creating,
}: {
  leads: ControlPlaneLead[];
  onCreate: (lead: { companyName: string; contactName?: string; contactEmail?: string }) => void;
  creating: boolean;
}) {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    leads: leads.filter((lead) => lead.stage === stage),
  }));

  return (
    <div className="space-y-4">
      <Panel eyebrow="Pipeline" title={`${leads.filter((lead) => lead.stage !== "lost" && lead.stage !== "won").length} open leads`}>
        {leads.length === 0 ? (
          <EmptyState>No leads yet. Add one below and the sales agent starts scoring it.</EmptyState>
        ) : (
          <div className="space-y-5">
            {byStage
              .filter((group) => group.leads.length > 0)
              .map((group) => (
                <div key={group.stage}>
                  <p className="mono-label mb-2 text-rose">
                    {group.stage} · {group.leads.length}
                  </p>
                  <ul className="space-y-2">
                    {group.leads.map((lead) => (
                      <li
                        key={lead.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-card-border bg-card px-3 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{lead.companyName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {lead.contactName ?? lead.contactEmail ?? lead.source}
                            {lead.lastTouchAt ? ` · touched ${formatRelative(lead.lastTouchAt)}` : ""}
                          </p>
                        </div>
                        <span className="mono-figure shrink-0 text-sm text-foreground">
                          {lead.score}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </Panel>

      <Panel eyebrow="Intake" title="Add a lead">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!companyName.trim()) return;
            onCreate({
              companyName: companyName.trim(),
              contactName: contactName.trim() || undefined,
              contactEmail: contactEmail.trim() || undefined,
            });
            setCompanyName("");
            setContactName("");
            setContactEmail("");
          }}
        >
          <input
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            placeholder="Venue name"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
            placeholder="Contact"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="Email"
            type="email"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="sm"
            variant="rose"
            disabled={!companyName.trim() || creating}
            className="sm:col-span-3 sm:justify-self-start"
          >
            {creating && <Loader2 className="animate-spin" />}
            Add lead
          </Button>
        </form>
      </Panel>
    </div>
  );
}

/* ————————————————————————— Product backlog ————————————————————————— */

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-red-300",
  high: "text-amber-300",
  medium: "text-muted-foreground",
  low: "text-muted-foreground",
};

export function ProductPanel({
  workItems,
  onStatus,
  busyId,
}: {
  workItems: ControlPlaneWorkItem[];
  onStatus: (id: number, status: string) => void;
  busyId: number | null;
}) {
  const open = workItems.filter((item) => item.status !== "done" && item.status !== "cancelled");
  const closed = workItems.filter((item) => item.status === "done" || item.status === "cancelled");

  return (
    <div className="space-y-4">
      <Panel eyebrow="Repair and upgrade backlog" title={`${open.length} open`}>
        {open.length === 0 ? (
          <EmptyState>
            Nothing is broken that the product agent can see. It files an item the moment the failure
            rate, delivery latency, or coverage quality slips.
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {open.map((item) => (
              <li key={item.id} className="rounded-lg border border-card-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("mono-label", SEVERITY_TONE[item.severity] ?? "")}>
                    {item.severity}
                  </span>
                  <span className="mono-label text-muted-foreground">{item.type}</span>
                  <span aria-hidden className="text-muted-foreground/40">·</span>
                  <span className="mono-label text-muted-foreground">{item.surface}</span>
                  <span className="mono-label ml-auto text-muted-foreground">{item.status}</span>
                </div>
                <h3 className="mt-2 font-display text-base font-medium leading-snug">{item.title}</h3>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.status !== "in_progress" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onStatus(item.id, "in_progress")}
                      disabled={busyId === item.id}
                    >
                      Start
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onStatus(item.id, "done")}
                    disabled={busyId === item.id}
                  >
                    {busyId === item.id && <Loader2 className="animate-spin" />}
                    Mark fixed
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {closed.length > 0 && (
        <Panel eyebrow="Closed" title={`${closed.length} resolved`}>
          <ul className="space-y-1.5">
            {closed.slice(0, 12).map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground line-through">{item.title}</span>
                <span className="mono-label shrink-0 text-muted-foreground">
                  {formatRelative(item.closedAt ?? item.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

/* ————————————————————————— Experiments ————————————————————————— */

export function ExperimentsPanel({ experiments }: { experiments: ControlPlaneExperiment[] }) {
  const running = experiments.filter((experiment) => experiment.status === "running");
  const finished = experiments.filter((experiment) => experiment.status !== "running");

  return (
    <div className="space-y-4">
      <Panel eyebrow="Running" title={`${running.length} live`}>
        {running.length === 0 ? (
          <EmptyState>
            Nothing is being tested. The experiments agent proposes one when a surface converts
            poorly enough to be worth the traffic.
          </EmptyState>
        ) : (
          <ul className="space-y-4">
            {running.map((experiment) => (
              <ExperimentCard key={experiment.id} experiment={experiment} />
            ))}
          </ul>
        )}
      </Panel>

      {finished.length > 0 && (
        <Panel eyebrow="Concluded" title={`${finished.length} settled`}>
          <ul className="space-y-4">
            {finished.slice(0, 8).map((experiment) => (
              <ExperimentCard key={experiment.id} experiment={experiment} />
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function ExperimentCard({ experiment }: { experiment: ControlPlaneExperiment }) {
  const exposures = experiment.variants.reduce((sum, variant) => sum + variant.exposures, 0);
  const progress = experiment.minimumSampleSize
    ? Math.min(1, exposures / experiment.minimumSampleSize)
    : 0;
  const best = [...experiment.variants].sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return (
    <li className="rounded-lg border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono-label text-rose">{experiment.surface}</span>
        <span aria-hidden className="text-muted-foreground/40">·</span>
        <span className="mono-label text-muted-foreground">{experiment.primaryMetric}</span>
        <span className="mono-label ml-auto text-muted-foreground">{experiment.status}</span>
      </div>
      <h3 className="mt-2 font-display text-base font-medium leading-snug">{experiment.key}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{experiment.hypothesis}</p>

      <div className="mt-3">
        <div className="h-1 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-rose" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mono-figure mt-1 text-[0.7rem] text-muted-foreground">
          {exposures} / {experiment.minimumSampleSize} exposures
          {experiment.ageDays !== null && experiment.ageDays !== undefined
            ? ` · day ${Math.round(experiment.ageDays)}`
            : ""}
        </p>
      </div>

      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left">
            <th className="mono-label pb-1 font-normal text-muted-foreground">Variant</th>
            <th className="mono-label pb-1 text-right font-normal text-muted-foreground">Exposed</th>
            <th className="mono-label pb-1 text-right font-normal text-muted-foreground">Converted</th>
            <th className="mono-label pb-1 text-right font-normal text-muted-foreground">Rate</th>
          </tr>
        </thead>
        <tbody>
          {experiment.variants.map((variant) => (
            <tr
              key={variant.key}
              className={cn(
                "border-t border-border/60",
                best && variant.key === best.key && exposures > 0 && "text-emerald-300",
              )}
            >
              <td className="py-1.5">{variant.label}</td>
              <td className="mono-figure py-1.5 text-right">{variant.exposures}</td>
              <td className="mono-figure py-1.5 text-right">{variant.conversions}</td>
              <td className="mono-figure py-1.5 text-right">
                {formatPercentValue(variant.conversionRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </li>
  );
}
