import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListControlPolicies,
  getListControlPoliciesQueryKey,
  useUpdateControlPolicy,
  getGetControlOverviewQueryKey,
  getGetControlOutreachSendingQueryKey,
  type ControlPolicy,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2, Pause, Play, MailX, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";

/*
 * Governance policies in the console: the header switches (autonomous_mode,
 * agents_enabled, outreach_sends_enabled) and editable policy cards. The
 * server validates every value (field names and bounds) and audits it.
 */

/** Keys written only by code (guard transitions, adaptation rules). */
export const SYSTEM_MANAGED_POLICIES = new Set(["deliverability_guard", "segment_guidance"]);

const POLICY_LABELS: Record<string, string> = {
  agents_enabled: "Agents running",
  outreach_sends_enabled: "Outbound email",
  autonomous_mode: "Autonomous mode",
  auto_execute_low_risk: "Auto-run low-risk actions (supervised)",
  max_prospect_emails_per_day: "Prospect emails per day (now)",
  max_prospect_emails_per_day_base: "Prospect emails per day (base)",
  max_outbound_emails_per_day: "Venue emails per day",
  min_hours_between_prospect_contacts: "Hours between emails to one prospect",
  max_contacts_per_prospect: "Emails per prospect, lifetime",
  max_credit_grant_per_action: "Credits per promo grant",
  max_credit_grants_per_day: "Promo credits per day",
  max_daily_ai_usd: "AI spend per day (USD)",
  vetting_pass_score: "Vetting pass score",
  vetting_review_score: "Vetting review score",
  vetting_blocked_countries: "Blocked countries",
  outreach_require_reply_to: "Require a reply-to mailbox",
  max_campaign_steps: "Steps per campaign",
  lifecycle_email_auto_send: "Auto-send trial emails (supervised)",
  max_lifecycle_emails_per_day: "Trial emails per day",
  deliverability_guard: "Deliverability guard",
  segment_guidance: "Segment guidance",
};

const POLICY_ORDER = [
  "autonomous_mode",
  "agents_enabled",
  "outreach_sends_enabled",
  "max_prospect_emails_per_day_base",
  "max_prospect_emails_per_day",
  "min_hours_between_prospect_contacts",
  "max_contacts_per_prospect",
  "outreach_require_reply_to",
  "vetting_pass_score",
  "vetting_review_score",
  "vetting_blocked_countries",
  "max_campaign_steps",
  "max_outbound_emails_per_day",
  "lifecycle_email_auto_send",
  "max_lifecycle_emails_per_day",
  "auto_execute_low_risk",
  "max_credit_grant_per_action",
  "max_credit_grants_per_day",
  "max_daily_ai_usd",
  "deliverability_guard",
  "segment_guidance",
];

export function policyLabel(key: string): string {
  return POLICY_LABELS[key] ?? key.replace(/_/g, " ");
}

function sortPolicies(policies: ControlPolicy[]): ControlPolicy[] {
  const rank = (key: string) => {
    const index = POLICY_ORDER.indexOf(key);
    return index === -1 ? POLICY_ORDER.length : index;
  };
  return [...policies].sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

export function usePolicies() {
  return useListControlPolicies({
    query: { queryKey: getListControlPoliciesQueryKey(), refetchInterval: 30000 },
  });
}

export function policyBoolean(policies: ControlPolicy[] | undefined, key: string, fallback = true): boolean {
  const raw = policies?.find((p) => p.key === key)?.value?.enabled;
  return typeof raw === "boolean" ? raw : fallback;
}

function usePolicyMutation(onDone?: () => void) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  return useUpdateControlPolicy({
    mutation: {
      onSuccess: (data) => {
        toast({ title: `${policyLabel(data.policy.key)} saved` });
        void queryClient.invalidateQueries({ queryKey: getListControlPoliciesQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getGetControlOutreachSendingQueryKey() });
        onDone?.();
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Policy not saved", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
}

/* ————— Kill switches (console header) ————— */

function KillSwitch({
  policyKey,
  enabled,
  onLabel,
  offLabel,
  stopVerb,
  startVerb,
  confirmText,
  iconOn,
  iconOff,
}: {
  policyKey: string;
  enabled: boolean;
  onLabel: string;
  offLabel: string;
  stopVerb: string;
  startVerb: string;
  confirmText: string;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const mutation = usePolicyMutation(() => setConfirming(false));
  const flip = () => mutation.mutate({ key: policyKey, data: { value: { enabled: !enabled } } });
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5",
        enabled ? "border-border" : "border-warning/50 bg-warning-soft",
      )}
    >
      <span className={cn("mono-label inline-flex items-center gap-1.5", enabled ? "text-success" : "text-warning")}>
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
        {enabled ? onLabel : offLabel}
      </span>
      {confirming ? (
        <>
          <span className="hidden text-xs text-muted-foreground md:inline">{confirmText}</span>
          <ActionButton tone="danger" disabled={mutation.isPending} onClick={flip}>
            {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Confirm
          </ActionButton>
          <ActionButton tone="neutral" disabled={mutation.isPending} onClick={() => setConfirming(false)}>
            Cancel
          </ActionButton>
        </>
      ) : (
        <ActionButton
          tone="neutral"
          disabled={mutation.isPending}
          onClick={() => (enabled ? setConfirming(true) : flip())}
          title={enabled ? confirmText : undefined}
        >
          {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : enabled ? iconOff : iconOn}
          {enabled ? stopVerb : startVerb}
        </ActionButton>
      )}
    </div>
  );
}

export function KillSwitches() {
  const policiesQuery = usePolicies();
  if (policiesQuery.isLoading || !policiesQuery.data) return null;
  const policies = policiesQuery.data.policies;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Kill switches">
      <KillSwitch
        policyKey="autonomous_mode"
        enabled={policyBoolean(policies, "autonomous_mode")}
        onLabel="autonomous"
        offLabel="supervised"
        stopVerb="Switch to supervised"
        startVerb="Go autonomous"
        confirmText="Emails, campaigns and credit grants will wait for your approval."
        iconOn={<Play className="h-3 w-3" />}
        iconOff={<Pause className="h-3 w-3" />}
      />
      <KillSwitch
        policyKey="agents_enabled"
        enabled={policyBoolean(policies, "agents_enabled")}
        onLabel="agents on"
        offLabel="agents paused"
        stopVerb="Pause all agents"
        startVerb="Resume agents"
        confirmText="No agent starts a run until you resume."
        iconOn={<Play className="h-3 w-3" />}
        iconOff={<Pause className="h-3 w-3" />}
      />
      <KillSwitch
        policyKey="outreach_sends_enabled"
        enabled={policyBoolean(policies, "outreach_sends_enabled")}
        onLabel="email on"
        offLabel="email frozen"
        stopVerb="Freeze outbound email"
        startVerb="Unfreeze email"
        confirmText="Every prospect send is refused until you unfreeze."
        iconOn={<Mail className="h-3 w-3" />}
        iconOff={<MailX className="h-3 w-3" />}
      />
    </div>
  );
}

/* ————— Policy cards ————— */

type Draft = Record<string, string | boolean>;

function toDraft(value: Record<string, unknown>): Draft {
  const draft: Draft = {};
  for (const [field, raw] of Object.entries(value)) {
    draft[field] = typeof raw === "boolean" ? raw : raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  }
  return draft;
}

function fromDraft(draft: Draft, original: Record<string, unknown>): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  for (const [field, raw] of Object.entries(draft)) {
    const before = original[field];
    if (typeof raw === "boolean") value[field] = raw;
    else if (typeof before === "number") value[field] = raw.trim() === "" ? raw : Number(raw);
    else value[field] = raw;
  }
  return value;
}

function PolicyCard({ policy }: { policy: ControlPolicy }) {
  const original = (policy.value ?? {}) as Record<string, unknown>;
  const [draft, setDraft] = useState<Draft>(() => toDraft(original));
  const mutation = usePolicyMutation();
  const managed = SYSTEM_MANAGED_POLICIES.has(policy.key);
  const baseline = toDraft(original);
  const dirty = Object.keys(draft).some((field) => draft[field] !== baseline[field]);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{policyLabel(policy.key)}</p>
          <p className="mono-label truncate text-muted-foreground">{policy.key}</p>
        </div>
        {managed ? <Pill value="system" /> : null}
      </div>
      {policy.description ? <p className="text-xs leading-relaxed text-muted-foreground">{policy.description}</p> : null}
      {managed ? (
        <pre className="overflow-x-auto rounded-md border border-border bg-background/60 p-2 text-[11px] text-foreground/80">
          {JSON.stringify(original, null, 2)}
        </pre>
      ) : (
        <div className="space-y-2">
          {Object.entries(draft).map(([field, value]) => (
            <label key={field} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-muted-foreground">{field}</span>
              {typeof value === "boolean" ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={value}
                  onClick={() => setDraft((d) => ({ ...d, [field]: !value }))}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    value ? "border-secondary bg-secondary" : "border-input bg-muted",
                  )}
                >
                  <span className="sr-only">{value ? "on" : "off"}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-card shadow-sm transition-transform",
                      value ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </button>
              ) : (
                <input
                  value={value}
                  inputMode={typeof original[field] === "number" ? "decimal" : undefined}
                  onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
                  className="h-8 w-28 rounded-md border border-input bg-background px-2 text-right text-xs tabular-nums text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className="mono-label text-muted-foreground">updated {fmt(policy.updatedAt)}</span>
        {!managed ? (
          <div className="flex gap-1.5">
            {dirty ? (
              <ActionButton tone="neutral" disabled={mutation.isPending} onClick={() => setDraft(baseline)}>
                Undo
              </ActionButton>
            ) : null}
            <ActionButton
              tone="primary"
              disabled={!dirty || mutation.isPending}
              onClick={() => mutation.mutate({ key: policy.key, data: { value: fromDraft(draft, original) } })}
            >
              {mutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Save
            </ActionButton>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function PolicyCards() {
  const policiesQuery = usePolicies();
  if (policiesQuery.isLoading) return <TabLoading />;
  const policies = sortPolicies(policiesQuery.data?.policies ?? []);
  if (policies.length === 0) {
    return <EmptyState text="No policies stored yet. They are created with their defaults when the scheduler starts." />;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {policies.map((policy) => (
        <PolicyCard key={`${policy.key}:${policy.updatedAt}`} policy={policy} />
      ))}
    </div>
  );
}
