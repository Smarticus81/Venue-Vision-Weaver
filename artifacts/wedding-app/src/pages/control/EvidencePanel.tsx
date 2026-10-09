import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetControlProspectEvidence,
  getGetControlProspectEvidenceQueryKey,
  useVetControlProspect,
  useOverrideControlProspectVetting,
  useAddControlProspectFact,
  useRemoveControlProspectFact,
  getListControlProspectsQueryKey,
  getListControlOutreachEmailsQueryKey,
  AddControlProspectFactBodyKind,
  type ControlVettingCheck,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";
import { VettingBadge } from "./VettingBadge";

/*
 * Vetting evidence for one prospect: the verdict, every check with its
 * sources, the sourced facts the copywriter may cite, and the last research
 * fetch. Mounted only when the operator opens it, so it fetches lazily.
 */

const OUTCOME: Record<string, { glyph: string; tone: string; label: string }> = {
  pass: { glyph: "✓", tone: "text-success", label: "pass" },
  warn: { glyph: "▲", tone: "text-warning", label: "warning" },
  fail: { glyph: "✕", tone: "text-danger", label: "fail" },
  skip: { glyph: "–", tone: "text-muted-foreground", label: "skipped" },
  error: { glyph: "!", tone: "text-danger", label: "error" },
};

const CITABLE_KINDS = ["space", "location", "capacity", "owner_name"];

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function CheckRow({ check }: { check: ControlVettingCheck }) {
  const outcome = OUTCOME[check.outcome] ?? OUTCOME.skip!;
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 py-1.5 text-xs">
      <span className={cn("font-mono", outcome.tone)} aria-label={outcome.label} title={outcome.label}>
        {outcome.glyph}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-foreground">
          {check.key.replace(/_/g, " ")}
          <span className="ml-2 text-muted-foreground">
            {check.points > 0 ? `+${check.points}` : check.points} pts{check.hardFail ? " · hard fail" : ""}
          </span>
        </p>
        <p className="leading-relaxed text-muted-foreground">{check.detail}</p>
        {check.evidence.length > 0 ? (
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            {check.evidence.map((evidence, index) => (
              <a
                key={`${evidence.url}:${index}`}
                href={evidence.url}
                target="_blank"
                rel="noreferrer"
                title={evidence.excerpt ?? undefined}
                className="underline hover:text-foreground"
              >
                {host(evidence.url)} · observed {fmt(evidence.observedAt)}
              </a>
            ))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function EvidencePanel({ prospectId }: { prospectId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const evidenceQuery = useGetControlProspectEvidence(prospectId, {
    query: { queryKey: getGetControlProspectEvidenceQueryKey(prospectId) },
  });
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<AddControlProspectFactBodyKind>("space");
  const [value, setValue] = useState("");
  const [sourceUrl, setSourceUrl] = useState("https://");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetControlProspectEvidenceQueryKey(prospectId) });
    void queryClient.invalidateQueries({ queryKey: getListControlProspectsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlOutreachEmailsQueryKey() });
  };
  const onError = (title: string) => (err: ErrorType<ErrorEnvelope>) =>
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });

  const vet = useVetControlProspect({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: data.vetting
            ? `Vetting finished: ${data.vetting.status} ${data.vetting.score}/100`
            : "Vetting finished",
        });
        invalidate();
      },
      onError: onError("Vetting failed"),
    },
  });
  const override = useOverrideControlProspectVetting({
    mutation: {
      onSuccess: () => {
        toast({ title: "Override saved" });
        setNote("");
        invalidate();
      },
      onError: onError("Override not saved"),
    },
  });
  const addFact = useAddControlProspectFact({
    mutation: {
      onSuccess: () => {
        toast({ title: "Fact added" });
        setValue("");
        setSourceUrl("https://");
        invalidate();
      },
      onError: onError("Fact not added"),
    },
  });
  const removeFact = useRemoveControlProspectFact({
    mutation: {
      onSuccess: () => {
        toast({ title: "Fact removed" });
        invalidate();
      },
      onError: onError("Fact not removed"),
    },
  });

  if (evidenceQuery.isLoading) return <TabLoading />;
  const evidence = evidenceQuery.data;
  if (!evidence) {
    return <p className="mt-3 text-xs text-danger">{apiErrorMessage(evidenceQuery.error)}</p>;
  }
  const { vetting, facts, research, assets } = evidence;
  const verified = facts.filter((f) => f.status === "verified").length;
  const busy = vet.isPending || override.isPending;
  const noteOk = note.trim().length >= 5;

  return (
    <div className="mt-3 space-y-4 border-t border-border pt-3">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <VettingBadge status={vetting?.status ?? "unvetted"} score={vetting?.score ?? null} />
            {vetting ? (
              <span className="mono-label text-muted-foreground">
                score {vetting.score}/100 · tier {vetting.tier} · vetted {fmt(vetting.vettedAt)} by {vetting.vettedBy} · expires{" "}
                {fmt(vetting.expiresAt)}
              </span>
            ) : null}
          </div>
          {vetting ? <p className="text-xs leading-relaxed text-foreground/85">{vetting.summary}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionButton
            tone="neutral"
            disabled={busy}
            title="Run legitimacy checks: site, domain age, mail records, address, listings"
            onClick={() => vet.mutate({ id: prospectId, data: { refresh: true } })}
          >
            {vet.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {vetting ? "Re-vet" : "Vet now"}
          </ActionButton>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why (required for overrides)"
            aria-label="Override note"
            maxLength={400}
            className="h-8 w-48 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <ActionButton
            tone="neutral"
            disabled={busy || !noteOk}
            title={noteOk ? "Mark this venue as legitimate" : "Write a note of at least 5 characters first"}
            onClick={() => override.mutate({ id: prospectId, data: { decision: "pass", note: note.trim() } })}
          >
            Override: pass
          </ActionButton>
          <ActionButton
            tone="danger"
            disabled={busy || !noteOk}
            title={noteOk ? "Mark this venue as not legitimate" : "Write a note of at least 5 characters first"}
            onClick={() => override.mutate({ id: prospectId, data: { decision: "fail", note: note.trim() } })}
          >
            Override: fail
          </ActionButton>
        </div>
      </header>

      {vetting ? (
        <section>
          <h4 className="mono-label text-muted-foreground">Checks</h4>
          <ul className="divide-y divide-border/60">
            {vetting.checks.map((check) => (
              <CheckRow key={check.key} check={check} />
            ))}
          </ul>
        </section>
      ) : (
        <EmptyState text="Not vetted yet. Run vetting to check the site, domain age, mail records, address and listings before anyone can email this venue." />
      )}

      <section className="space-y-2">
        <h4 className="mono-label text-muted-foreground">
          Facts ({verified}/{facts.length} verified)
        </h4>
        {facts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No sourced facts yet.</p>
        ) : (
          <ul className="space-y-1">
            {facts.map((fact) => (
              <li key={fact.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <Pill value={fact.status} />
                <span className="mono-label text-muted-foreground">{fact.kind.replace(/_/g, " ")}</span>
                <span className="min-w-0 text-foreground">{fact.value}</span>
                <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground underline hover:text-foreground">
                  {host(fact.sourceUrl)}
                </a>
                <span className="mono-label text-muted-foreground">{fact.sourceKind.replace(/_/g, " ")}</span>
                <ActionButton
                  tone="danger"
                  disabled={removeFact.isPending}
                  title="Remove so it can't be cited"
                  onClick={() => removeFact.mutate({ id: prospectId, factId: fact.id })}
                >
                  Remove
                </ActionButton>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            addFact.mutate({ id: prospectId, data: { kind, value: value.trim(), sourceUrl: sourceUrl.trim() } });
          }}
        >
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AddControlProspectFactBodyKind)}
            aria-label="Fact kind"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            {Object.values(AddControlProspectFactBodyKind).map((k) => (
              <option key={k} value={k}>
                {k.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value, e.g. The Timber Barn"
            aria-label="Fact value"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://"
            aria-label="Source URL"
            inputMode="url"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={addFact.isPending || value.trim().length === 0 || !/^https:\/\/\S+\.\S+/.test(sourceUrl.trim())}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-soft disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add verified fact
          </button>
        </form>
        <p className="text-[11px] text-muted-foreground">
          Only verified facts can appear in an email ({CITABLE_KINDS.map((k) => k.replace(/_/g, " ")).join(", ")} count toward the two an email must cite). Adding one here means you checked the source yourself.
        </p>
      </section>

      {research ? (
        <section className="space-y-1 text-xs">
          <h4 className="mono-label flex items-center gap-2 text-muted-foreground">
            Research <Pill value={research.status} />
          </h4>
          <p className="text-muted-foreground">
            Fetched {fmt(research.fetchedAt)} · {assets.length} photo{assets.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-0.5">
            {research.sourceUrls.map((url) => (
              <li key={url} className="truncate text-[11px]">
                <a href={url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
