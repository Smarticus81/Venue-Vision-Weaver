import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetControlOverviewQueryKey,
  getListControlActionsQueryKey,
  useListControlProspects,
  getListControlProspectsQueryKey,
  useSetControlProspectStatus,
  useListControlCampaigns,
  getListControlCampaignsQueryKey,
  useDraftControlOutreachEmail,
  getListControlOutreachEmailsQueryKey,
  type ControlProspect,
  type ControlCampaign,
  type ControlProspectStatusBodyStatus,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

/* ————— Pipeline: prospects + campaigns ————— */

const PROSPECT_TRANSITIONS: Record<
  string,
  Array<{ status: ControlProspectStatusBodyStatus; label: string; tone: "primary" | "neutral" | "danger" }>
> = {
  new: [
    { status: "qualified", label: "Qualify", tone: "primary" },
    { status: "disqualified", label: "Disqualify", tone: "danger" },
  ],
  qualified: [{ status: "disqualified", label: "Disqualify", tone: "danger" }],
  contacted: [
    { status: "replied", label: "Replied", tone: "neutral" },
    { status: "converted", label: "Converted", tone: "primary" },
    { status: "unsubscribed", label: "Unsubscribed", tone: "danger" },
  ],
  replied: [
    { status: "converted", label: "Converted", tone: "primary" },
    { status: "unsubscribed", label: "Unsubscribed", tone: "danger" },
  ],
  disqualified: [{ status: "qualified", label: "Requalify", tone: "neutral" }],
};

function ProspectRow({ prospect, campaigns }: { prospect: ControlProspect; campaigns: ControlCampaign[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const setStatus = useSetControlProspectStatus({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${prospect.name} marked ${data.prospect.status.replace(/_/g, " ")}` });
        void queryClient.invalidateQueries({ queryKey: getListControlProspectsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListControlCampaignsQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Update failed", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const draft = useDraftControlOutreachEmail({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: `Draft #${data.detail.email.id} queued for ${prospect.name}`,
          description: "Review it in the Outreach tab; nothing sends until you approve it.",
        });
        void queryClient.invalidateQueries({ queryKey: getListControlOutreachEmailsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListControlActionsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Could not draft", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const campaign = prospect.campaignId
    ? campaigns.find((c) => c.id === prospect.campaignId)
    : undefined;
  const transitions = PROSPECT_TRANSITIONS[prospect.status] ?? [];
  const draftable = ["new", "qualified", "contacted"].includes(prospect.status);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Pill value={prospect.status} />
          <span className="text-sm font-medium text-foreground">{prospect.name}</span>
          <span className="mono-label text-muted-foreground">{prospect.email}</span>
          {prospect.region ? (
            <span className="mono-label text-muted-foreground">{prospect.region}</span>
          ) : null}
        </div>
        <span className="mono-label text-brand">score {prospect.score}</span>
      </div>
      {prospect.qualification ? (
        <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
          {prospect.qualification}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="mono-label flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
          <span>
            {prospect.contactCount} email{prospect.contactCount === 1 ? "" : "s"} sent
            {prospect.lastContactedAt ? ` · last ${fmt(prospect.lastContactedAt)}` : ""}
          </span>
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
        {transitions.length > 0 || draftable ? (
          <div className="flex items-center gap-1.5">
            {draftable ? (
              <ActionButton
                tone="neutral"
                disabled={draft.isPending}
                title="Research the venue site and draft a studio email for approval"
                onClick={() => draft.mutate({ id: prospect.id, data: {} })}
              >
                {draft.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
                Draft email
              </ActionButton>
            ) : null}
            {transitions.map((transition) => (
              <ActionButton
                key={transition.status}
                tone={transition.tone}
                disabled={setStatus.isPending}
                onClick={() => setStatus.mutate({ id: prospect.id, data: { status: transition.status } })}
              >
                {setStatus.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {transition.label}
              </ActionButton>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function CampaignCard({ campaign }: { campaign: ControlCampaign }) {
  const counts = campaign.prospectCounts as Record<string, number | undefined>;
  const enrolled = Object.values(counts).reduce((sum: number, n) => sum + (n ?? 0), 0);
  const steps = (campaign.steps ?? []) as Array<Record<string, unknown>>;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Pill value={campaign.status} />
          <span className="text-sm font-medium text-foreground">{campaign.name}</span>
        </div>
        <span className="mono-label text-muted-foreground">
          {campaign.createdByAgent ?? "operator"} · {fmt(campaign.createdAt)}
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
      <div className="mono-label mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-muted-foreground">
        <span className="text-foreground/80">{enrolled} enrolled</span>
        <span>{counts.contacted ?? 0} contacted</span>
        <span className="text-success">{counts.replied ?? 0} replied</span>
        <span className="text-success">{counts.converted ?? 0} converted</span>
        <span>{counts.unsubscribed ?? 0} unsubscribed</span>
      </div>
    </Card>
  );
}

const PROSPECT_FILTERS = [
  "all",
  "new",
  "qualified",
  "contacted",
  "replied",
  "converted",
  "unsubscribed",
  "disqualified",
] as const;

export function PipelineTab() {
  const [filter, setFilter] = useState<(typeof PROSPECT_FILTERS)[number]>("all");
  const params = filter === "all" ? {} : { status: filter };
  const prospectsQuery = useListControlProspects(params, {
    query: { queryKey: getListControlProspectsQueryKey(params), refetchInterval: 30000 },
  });
  const campaignsQuery = useListControlCampaigns(
    {},
    { query: { queryKey: getListControlCampaignsQueryKey(), refetchInterval: 30000 } },
  );
  const prospects = prospectsQuery.data?.prospects ?? [];
  const campaigns = campaignsQuery.data?.campaigns ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Campaigns ({campaigns.length})</h2>
        {campaignsQuery.isLoading ? (
          <TabLoading />
        ) : campaigns.length === 0 ? (
          <EmptyState text="No campaigns yet. The campaigns agent designs multi-step sequences here; launching one is a governed action." />
        ) : (
          campaigns.map((campaign) => <CampaignCard key={campaign.id} campaign={campaign} />)
        )}
      </section>
      <section className="space-y-3">
        <h2 className="mono-label text-muted-foreground">Prospects</h2>
        <div className="flex flex-wrap gap-1.5">
          {PROSPECT_FILTERS.map((value) => (
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
              {value}
            </button>
          ))}
        </div>
        {prospectsQuery.isLoading ? (
          <TabLoading />
        ) : prospects.length === 0 ? (
          <EmptyState text="No prospects here. The prospecting agent researches and qualifies potential venue customers; outreach goes through the approval queue. Mark replies, conversions, and unsubscribes as they land in your inbox." />
        ) : (
          prospects.map((prospect) => (
            <ProspectRow key={prospect.id} prospect={prospect} campaigns={campaigns} />
          ))
        )}
      </section>
    </div>
  );
}
