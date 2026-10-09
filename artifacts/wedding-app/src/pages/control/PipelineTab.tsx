import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetControlOverviewQueryKey,
  getListControlActionsQueryKey,
  useListControlProspects,
  getListControlProspectsQueryKey,
  useSetControlProspectStatus,
  useListControlCampaigns,
  getListControlCampaignsQueryKey,
  useSetControlCampaignStatus,
  useDraftControlOutreachEmail,
  useVetControlProspect,
  getGetControlProspectEvidenceQueryKey,
  getListControlOutreachEmailsQueryKey,
  type ControlProspect,
  type ControlCampaign,
  type ControlCampaignStatusBodyStatus,
  type ControlProspectStatusBodyStatus,
  type ControlProspectStatusBodyReplySentiment,
  type ListControlProspectsParams,
  type ListControlProspectsSort,
  type ListControlProspectsStatus,
  type ListControlProspectsVettingStatus,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { ChevronDown, ChevronUp, ExternalLink, Loader2, Mail, Search, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";
import { VettingBadge } from "./VettingBadge";
import { EvidencePanel } from "./EvidencePanel";

/* ————— Pipeline: campaigns + prospects ————— */

/**
 * Operator prospect moves. Mirrors PROSPECT_TRANSITIONS in lib/db (the
 * server enforces it and answers 409 otherwise); "contacted" is set only by
 * the governed send, so it is never offered here. Converted and unsubscribed
 * are terminal.
 */
export const PROSPECT_TRANSITIONS: Record<string, ControlProspectStatusBodyStatus[]> = {
  new: ["qualified", "disqualified", "unsubscribed", "converted"],
  qualified: ["replied", "converted", "unsubscribed", "disqualified"],
  contacted: ["replied", "converted", "unsubscribed", "disqualified"],
  replied: ["converted", "unsubscribed", "disqualified"],
  disqualified: ["qualified"],
  converted: [],
  unsubscribed: [],
};

const TRANSITION_LABEL: Record<string, { label: string; tone: "primary" | "neutral" | "danger" }> = {
  qualified: { label: "Qualify", tone: "neutral" },
  disqualified: { label: "Disqualify", tone: "danger" },
  replied: { label: "Replied", tone: "neutral" },
  converted: { label: "Converted", tone: "neutral" },
  unsubscribed: { label: "Unsubscribed", tone: "danger" },
};

/** Statuses whose prospects may get a new studio draft (vetting must have passed too). */
const DRAFTABLE = new Set(["new", "qualified", "contacted"]);

export function canDraft(prospect: Pick<ControlProspect, "status" | "vettingStatus">): boolean {
  return DRAFTABLE.has(prospect.status) && prospect.vettingStatus === "passed";
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ProspectRow({ prospect, campaigns }: { prospect: ControlProspect; campaigns: ControlCampaign[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<ControlProspectStatusBodyStatus | null>(null);
  const invalidateProspects = () => {
    void queryClient.invalidateQueries({ queryKey: getListControlProspectsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlCampaignsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
  };
  const setStatus = useSetControlProspectStatus({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${prospect.name} marked ${data.prospect.status.replace(/_/g, " ")}` });
        setConfirm(null);
        invalidateProspects();
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Update failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const vet = useVetControlProspect({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: data.vetting ? `Vetting finished: ${data.vetting.status} ${data.vetting.score}/100` : "Vetting finished",
        });
        void queryClient.invalidateQueries({ queryKey: getGetControlProspectEvidenceQueryKey(prospect.id) });
        invalidateProspects();
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Vetting failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const draft = useDraftControlOutreachEmail({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: `Draft #${data.detail.email.id} queued for ${prospect.name}`,
          description: "Review it in the Outreach tab; nothing sends until you approve it there.",
        });
        void queryClient.invalidateQueries({ queryKey: getListControlOutreachEmailsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListControlActionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Could not draft", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });

  const campaign = prospect.campaignId ? campaigns.find((c) => c.id === prospect.campaignId) : undefined;
  const transitions = PROSPECT_TRANSITIONS[prospect.status] ?? [];
  const vetted = prospect.vettingStatus === "passed";
  const draftable = canDraft(prospect);
  const needsVetting = DRAFTABLE.has(prospect.status) && !vetted;
  const busy = setStatus.isPending || vet.isPending || draft.isPending;

  const move = (status: ControlProspectStatusBodyStatus, replySentiment?: ControlProspectStatusBodyReplySentiment) =>
    setStatus.mutate({ id: prospect.id, data: { status, ...(replySentiment ? { replySentiment } : {}) } });

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <Pill value={prospect.status} />
            <VettingBadge status={prospect.vettingStatus} score={prospect.legitimacyScore ?? null} />
            <span className="text-sm font-medium text-foreground">{prospect.name}</span>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              {prospect.contactName ? `${prospect.contactName} · ` : ""}
              <span className="font-mono">{prospect.email}</span>
            </span>
            {prospect.website ? (
              <a href={prospect.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-foreground">
                <ExternalLink className="h-3 w-3" />
                {host(prospect.website)}
              </a>
            ) : (
              <span className="text-warning">no website</span>
            )}
            {prospect.region ? <span>{prospect.region}</span> : null}
            {prospect.venueType ? <span>{prospect.venueType.replace(/_/g, " ")}</span> : null}
          </p>
        </div>
        <span className="mono-label text-brand" title="Fit score from the prospecting agent">
          fit {prospect.score}
        </span>
      </div>
      {prospect.qualification ? (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{prospect.qualification}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="mono-label flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>
            {prospect.contactCount} email{prospect.contactCount === 1 ? "" : "s"} sent
            {prospect.lastContactedAt ? ` · last ${fmt(prospect.lastContactedAt)}` : ""}
          </span>
          {prospect.vettedAt ? <span>vetted {fmt(prospect.vettedAt)}</span> : null}
          {prospect.repliedAt ? (
            <span>
              replied {fmt(prospect.repliedAt)}
              {prospect.replySentiment ? ` (${prospect.replySentiment})` : ""}
            </span>
          ) : null}
          {campaign ? (
            <span>
              {campaign.name}
              {prospect.campaignStep > 0 ? ` · step ${prospect.campaignStep}` : ""}
            </span>
          ) : null}
          <span>
            via {prospect.createdByAgent ?? prospect.source.replace(/_/g, " ")} · {fmt(prospect.createdAt)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionButton tone="neutral" onClick={() => setOpen((v) => !v)} title="Vetting checks, sourced facts and research">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Evidence
          </ActionButton>
          {needsVetting ? (
            <ActionButton
              tone="neutral"
              disabled={busy}
              title="Run legitimacy checks: site, domain age, mail records, address, listings"
              onClick={() => vet.mutate({ id: prospect.id, data: { refresh: true } })}
            >
              {vet.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
              {prospect.vettingStatus === "review" || prospect.vettingStatus === "failed" ? "Re-vet" : "Vet"}
            </ActionButton>
          ) : null}
          {draftable ? (
            <ActionButton
              tone="primary"
              disabled={busy}
              title="Research the venue site and draft a studio email for approval"
              onClick={() => draft.mutate({ id: prospect.id, data: {} })}
            >
              {draft.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
              Draft email
            </ActionButton>
          ) : null}
          {confirm === "replied" ? (
            <>
              <span className="text-xs text-muted-foreground">Reply was</span>
              {(["positive", "neutral", "negative"] as const).map((sentiment) => (
                <ActionButton key={sentiment} tone="neutral" disabled={busy} onClick={() => move("replied", sentiment)}>
                  {sentiment}
                </ActionButton>
              ))}
              <ActionButton tone="neutral" onClick={() => setConfirm(null)}>
                Cancel
              </ActionButton>
            </>
          ) : confirm ? (
            <>
              <span className="text-xs text-muted-foreground">
                {confirm === "unsubscribed"
                  ? "Permanent: the address is suppressed for every future send."
                  : confirm === "converted"
                    ? "Final: record this venue as a customer?"
                    : `Mark ${confirm}?`}
              </span>
              <ActionButton tone="danger" disabled={busy} onClick={() => move(confirm)}>
                {setStatus.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Confirm
              </ActionButton>
              <ActionButton tone="neutral" onClick={() => setConfirm(null)}>
                Cancel
              </ActionButton>
            </>
          ) : (
            transitions.map((status) => {
              const meta = TRANSITION_LABEL[status] ?? { label: status, tone: "neutral" as const };
              const gated = status === "qualified" && !vetted;
              const label = status === "qualified" && prospect.status === "disqualified" ? "Requalify" : meta.label;
              return (
                <ActionButton
                  key={status}
                  tone={meta.tone}
                  disabled={busy || gated}
                  title={gated ? "Vetting must pass first" : undefined}
                  onClick={() =>
                    status === "replied" || status === "unsubscribed" || status === "converted"
                      ? setConfirm(status)
                      : move(status)
                  }
                >
                  {label}
                </ActionButton>
              );
            })
          )}
        </div>
      </div>
      {open ? <EvidencePanel prospectId={prospect.id} /> : null}
    </Card>
  );
}

/* ————— Campaigns ————— */

const CAMPAIGN_MOVES: Record<string, Array<{ status: ControlCampaignStatusBodyStatus; label: string; tone: "primary" | "neutral" | "danger"; confirm?: string }>> = {
  draft: [
    { status: "active", label: "Launch", tone: "primary", confirm: "Enrolled prospects become eligible for drafts; every email still needs your approval." },
    { status: "completed", label: "Abandon", tone: "danger", confirm: "Close this draft campaign for good?" },
  ],
  active: [
    { status: "paused", label: "Pause", tone: "neutral" },
    { status: "completed", label: "Complete", tone: "danger", confirm: "No further steps will be drafted for this campaign." },
  ],
  paused: [
    { status: "active", label: "Resume", tone: "primary" },
    { status: "completed", label: "Complete", tone: "danger", confirm: "No further steps will be drafted for this campaign." },
  ],
  completed: [],
};

function CampaignCard({ campaign }: { campaign: ControlCampaign }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ControlCampaignStatusBodyStatus | null>(null);
  const setStatus = useSetControlCampaignStatus({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${data.campaign.name} is ${data.campaign.status}` });
        setPending(null);
        void queryClient.invalidateQueries({ queryKey: getListControlCampaignsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListControlActionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Campaign not changed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const counts = campaign.prospectCounts as Record<string, number | undefined>;
  const enrolled = Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0);
  const steps = (campaign.steps ?? []) as Array<Record<string, unknown>>;
  const moves = CAMPAIGN_MOVES[campaign.status] ?? [];
  const confirming = moves.find((m) => m.status === pending);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Pill value={campaign.status} />
          <span className="text-sm font-medium text-foreground">{campaign.name}</span>
        </div>
        <span className="mono-label text-muted-foreground">
          {campaign.createdByAgent ?? "operator"} · {fmt(campaign.createdAt)}
          {campaign.launchedAt ? ` · launched ${fmt(campaign.launchedAt)}` : ""}
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{campaign.objective}</p>
      {campaign.audience ? (
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="text-foreground/70">Audience:</span> {campaign.audience}
        </p>
      ) : null}
      {steps.length > 0 ? (
        <ol className="mt-3 space-y-1.5 border-t border-border pt-3">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span className="mono-label shrink-0 text-brand">
                {index + 1}
                {Number(step.waitDays) > 0 ? ` · +${Number(step.waitDays)}d` : ""}
              </span>
              <span>{String(step.guidance ?? "")}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="mono-label flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
          <span className="text-foreground/80">{enrolled} enrolled</span>
          <span>{counts.contacted ?? 0} contacted</span>
          <span>{counts.replied ?? 0} replied</span>
          <span>{counts.converted ?? 0} converted</span>
          <span>{counts.unsubscribed ?? 0} unsubscribed</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {confirming ? (
            <>
              <span className="text-xs text-muted-foreground">{confirming.confirm}</span>
              <ActionButton
                tone={confirming.tone === "danger" ? "danger" : "primary"}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: campaign.id, data: { status: confirming.status } })}
              >
                {setStatus.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Confirm {confirming.label.toLowerCase()}
              </ActionButton>
              <ActionButton tone="neutral" onClick={() => setPending(null)}>
                Cancel
              </ActionButton>
            </>
          ) : (
            moves.map((move) => (
              <ActionButton
                key={move.status}
                tone={move.tone}
                disabled={setStatus.isPending}
                onClick={() =>
                  move.confirm ? setPending(move.status) : setStatus.mutate({ id: campaign.id, data: { status: move.status } })
                }
              >
                {move.label}
              </ActionButton>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

/* ————— Tab ————— */

const STATUS_FILTERS = ["all", "new", "qualified", "contacted", "replied", "converted", "unsubscribed", "disqualified"] as const;
const VETTING_FILTERS = ["all", "unvetted", "passed", "review", "failed", "error"] as const;
const SORTS: Array<{ value: ListControlProspectsSort; label: string }> = [
  { value: "score", label: "best fit" },
  { value: "newest", label: "newest" },
  { value: "updated", label: "recently updated" },
];
const PAGE_SIZE = 50;

function Chips<T extends string>({
  label,
  values,
  value,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      <span className="mono-label mr-1 text-muted-foreground">{label}</span>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "mono-label h-8 rounded-md border px-3 transition-colors",
            value === v ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

export function PipelineTab() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [vetting, setVetting] = useState<(typeof VETTING_FILTERS)[number]>("all");
  const [sort, setSort] = useState<ListControlProspectsSort>("score");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const params: ListControlProspectsParams = {
    limit: PAGE_SIZE,
    offset,
    sort,
    ...(status === "all" ? {} : { status: status as ListControlProspectsStatus }),
    ...(vetting === "all" ? {} : { vettingStatus: vetting as ListControlProspectsVettingStatus }),
    ...(q ? { q: q.slice(0, 120) } : {}),
  };
  const prospectsQuery = useListControlProspects(params, {
    query: { queryKey: getListControlProspectsQueryKey(params), refetchInterval: 30000, placeholderData: (prev) => prev },
  });
  const campaignsQuery = useListControlCampaigns(
    {},
    { query: { queryKey: getListControlCampaignsQueryKey(), refetchInterval: 30000 } },
  );
  const prospects = prospectsQuery.data?.prospects ?? [];
  const campaigns = campaignsQuery.data?.campaigns ?? [];
  const hasNext = prospects.length === PAGE_SIZE;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Campaigns ({campaigns.length})</h2>
        {campaignsQuery.isLoading ? (
          <TabLoading />
        ) : campaigns.length === 0 ? (
          <EmptyState text="No campaigns yet. The campaigns agent designs multi-step sequences here; you launch, pause or complete them." />
        ) : (
          campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)
        )}
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="mono-label text-muted-foreground">
            Prospects ({prospects.length === 0 ? 0 : `${offset + 1}–${offset + prospects.length}`})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex items-center">
              <Search aria-hidden className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, website, region"
                aria-label="Search prospects"
                maxLength={120}
                className="h-8 w-64 max-w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value as ListControlProspectsSort);
                setOffset(0);
              }}
              aria-label="Sort prospects"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Chips
          label="status"
          values={STATUS_FILTERS}
          value={status}
          onChange={(next) => {
            setStatus(next);
            setOffset(0);
          }}
        />
        <Chips
          label="vetting"
          values={VETTING_FILTERS}
          value={vetting}
          onChange={(next) => {
            setVetting(next);
            setOffset(0);
          }}
        />
        {prospectsQuery.isLoading ? (
          <TabLoading />
        ) : prospects.length === 0 ? (
          <EmptyState text="No prospects match. The prospecting agent researches and qualifies potential venue customers; vet them, then draft. Mark replies, conversions and unsubscribes as they land in your inbox." />
        ) : (
          <>
            {prospects.map((prospect) => (
              <ProspectRow key={prospect.id} prospect={prospect} campaigns={campaigns} />
            ))}
            {offset > 0 || hasNext ? (
              <div className="flex items-center justify-end gap-1.5">
                <ActionButton tone="neutral" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </ActionButton>
                <ActionButton tone="neutral" disabled={!hasNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Next
                </ActionButton>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
