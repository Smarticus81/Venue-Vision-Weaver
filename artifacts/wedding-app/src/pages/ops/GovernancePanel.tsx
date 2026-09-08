import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import type {
  ControlPlaneAuditEntry,
  ControlPlaneMemoryNote,
  ControlPlanePolicy,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, formatRelative } from "./primitives";

type PolicyPatch = Partial<Record<keyof ControlPlanePolicy, boolean | number>>;

const TOGGLES: {
  key: "autoExecuteEnabled" | "outboundEmailEnabled";
  label: string;
  description: string;
}[] = [
  {
    key: "autoExecuteEnabled",
    label: "Autonomous execution",
    description:
      "When off, every agent keeps observing and proposing but nothing runs without your approval.",
  },
  {
    key: "outboundEmailEnabled",
    label: "Outbound email",
    description:
      "Lets agents send venue nudges and sales outreach. Off by default: these messages reach people outside the company.",
  },
];

const NUMBERS: { key: keyof ControlPlanePolicy; label: string; hint: string; step?: number }[] = [
  {
    key: "maxAutoExecutionsPerDay",
    label: "Automatic executions per day",
    hint: "Org-wide ceiling across the whole fleet.",
  },
  {
    key: "confidenceFloor",
    label: "Confidence floor",
    hint: "Proposals below this always wait for you.",
    step: 0.05,
  },
  {
    key: "maxCreditGrant",
    label: "Largest credit grant",
    hint: "An agent may never propose a grant above this, at any autonomy level.",
  },
  {
    key: "reviewSlaHours",
    label: "Review target (hours)",
    hint: "Governance flags decisions left open longer than this.",
  },
  {
    key: "decisionTtlHours",
    label: "Decision lifetime (hours)",
    hint: "Unreviewed decisions expire so the queue stays current.",
  },
];

export function GovernancePanel({
  policy,
  onPolicyChange,
  onKillSwitch,
  audit,
  memory,
  saving,
}: {
  policy: ControlPlanePolicy;
  onPolicyChange: (patch: PolicyPatch) => void;
  onKillSwitch: (engaged: boolean) => void;
  audit: ControlPlaneAuditEntry[];
  memory: ControlPlaneMemoryNote[];
  saving: boolean;
}) {
  return (
    <div className="space-y-4">
      <section
        className={cn(
          "glimpse-card p-5 sm:p-6",
          policy.killSwitch ? "border-red-400/40 bg-red-400/5" : "",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mono-label mb-1.5 text-rose">Master stop</p>
            <h2 className="flex items-center gap-2 font-display text-lg font-medium leading-tight">
              {policy.killSwitch ? (
                <AlertTriangle className="h-4 w-4 text-red-300" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
              )}
              {policy.killSwitch ? "Kill switch engaged" : "Fleet is live"}
            </h2>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              {policy.killSwitch
                ? "Nothing executes — not a scheduled decision, not one you approve. Agents keep observing so the queue reflects reality when you release it."
                : "Agents execute within their autonomy level and the guardrails below. High-risk decisions always wait for you."}
            </p>
          </div>
          <Button
            variant={policy.killSwitch ? "rose" : "destructive"}
            onClick={() => onKillSwitch(!policy.killSwitch)}
            disabled={saving}
          >
            {saving && <Loader2 className="animate-spin" />}
            {policy.killSwitch ? "Release the stop" : "Stop everything"}
          </Button>
        </div>
      </section>

      <Panel eyebrow="Guardrails" title="What the fleet may do without asking">
        <div className="space-y-5">
          {TOGGLES.map((toggle) => (
            <label key={toggle.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={Boolean(policy[toggle.key])}
                onChange={(event) => onPolicyChange({ [toggle.key]: event.target.checked })}
                className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--rose))]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{toggle.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {toggle.description}
                </span>
              </span>
            </label>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            {NUMBERS.map((field) => (
              <label key={String(field.key)} className="block">
                <span className="mono-label mb-1.5 block text-muted-foreground">{field.label}</span>
                <input
                  type="number"
                  step={field.step ?? 1}
                  defaultValue={Number(policy[field.key])}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value) || value === Number(policy[field.key])) return;
                    onPolicyChange({ [field.key]: value });
                  }}
                  className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {field.hint}
                </span>
              </label>
            ))}
          </div>

          <div>
            <p className="mono-label mb-1.5 text-muted-foreground">Always requires approval</p>
            <div className="flex flex-wrap gap-1.5">
              {policy.alwaysApprove.map((effect) => (
                <span
                  key={effect}
                  className="mono-label rounded-full border border-border px-2 py-0.5 text-muted-foreground"
                >
                  {effect}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              High-risk effects always reach a human regardless of this list — an agent cannot widen
              its own authority.
            </p>
          </div>
        </div>
      </Panel>

      <Panel eyebrow="Audit" title="Everything the fleet did">
        {audit.length === 0 ? (
          <EmptyState>No activity recorded yet.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {audit.slice(0, 40).map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/50 pb-2 text-sm last:border-0"
              >
                <span className="mono-label text-rose">{entry.action}</span>
                <span className="text-muted-foreground">
                  {entry.actorType === "human" ? "you" : entry.actor}
                </span>
                {entry.subjectType && (
                  <span className="text-xs text-muted-foreground">
                    {entry.subjectType} {entry.subjectId}
                  </span>
                )}
                <span className="mono-label ml-auto text-muted-foreground">
                  {formatRelative(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel eyebrow="Memory" title="What the fleet has learned">
        {memory.length === 0 ? (
          <EmptyState>Nothing recorded yet. Agents write here when a week is unusual.</EmptyState>
        ) : (
          <ul className="space-y-2.5">
            {memory.slice(0, 25).map((note) => (
              <li key={note.id} className="text-sm leading-relaxed">
                <span className="mono-label mr-2 text-muted-foreground">{note.agentKey}</span>
                <span className="text-foreground/90">{note.content}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
