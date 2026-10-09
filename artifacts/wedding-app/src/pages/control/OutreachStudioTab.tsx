import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListControlOutreachEmails,
  getListControlOutreachEmailsQueryKey,
  useGetControlOutreachEmail,
  getGetControlOutreachEmailQueryKey,
  useUpdateControlOutreachEmail,
  useRegenerateControlOutreachEmail,
  useDecideControlAction,
  useGetControlOutreachSending,
  getGetControlOutreachSendingQueryKey,
  useSetControlOutreachSending,
  getListControlActionsQueryKey,
  getGetControlOverviewQueryKey,
  getListControlProspectsQueryKey,
  type ControlActionDecisionBody,
  type ControlOutreachEmailDetail,
  type ControlOutreachEmailListItem,
  type ControlOutreachAsset,
  type ListControlOutreachEmailsParams,
  type ErrorEnvelope,
  type ErrorType,
} from "@workspace/api-client-react";
import { Loader2, Monitor, Smartphone, Sun, Moon, RefreshCw, ExternalLink, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ActionButton, Card, EmptyState, Pill, TabLoading, apiErrorMessage, fmt } from "./shared";
import { VettingBadge } from "./VettingBadge";

/**
 * Outreach studio. In autonomous mode agent-drafted emails send after a
 * two-minute hold and can be cancelled here until then; in supervised mode
 * this is the only place a prospect email is approved. Operators
 * review each agent-drafted venue email with the real rendering
 * (desktop/mobile, light/dark), the venue's vetting, the verified facts the
 * copy cites, the photos and where they came from. They can edit, swap or
 * drop images, regenerate, and approve (which sends through the governed
 * action, marked as reviewed) or reject.
 *
 * Keyboard: j / k move to the next / previous email in the list.
 */

const LIST_FILTERS = ["awaiting", "all", "sent", "delivered", "bounced", "complained", "rejected", "failed"] as const;
type ListFilter = (typeof LIST_FILTERS)[number];
const PAGE_SIZE = 50;
const SUBJECT_MAX = 50;
const OVERRIDE_NOTE_MIN = 5;

function queueState(item: ControlOutreachEmailListItem): string {
  if (item.email.status === "draft") return item.actionStatus ?? "draft";
  return item.email.status;
}

function isAwaiting(item: ControlOutreachEmailListItem): boolean {
  return item.email.status === "draft" && (item.actionStatus ?? "pending") === "pending";
}

function filterParams(filter: ListFilter, offset: number): ListControlOutreachEmailsParams {
  const base = { limit: PAGE_SIZE, offset };
  if (filter === "awaiting") return { ...base, awaiting: true };
  if (filter === "all") return base;
  return { ...base, status: filter };
}

/** Copy-rule violations the copywriter could not fix (draftNotes.violations). */
export function copyViolations(draftNotes: unknown): string[] {
  const raw = (draftNotes as Record<string, unknown> | null | undefined)?.violations;
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : [];
}

function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/* ————— Sending state banner (deliverability guard) ————— */

function SendingBanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const sendingQuery = useGetControlOutreachSending({
    query: { queryKey: getGetControlOutreachSendingQueryKey(), refetchInterval: 30000, retry: false },
  });
  const setSending = useSetControlOutreachSending({
    mutation: {
      onSuccess: (data) => {
        toast({ title: data.guard.status === "paused" ? "Sending paused" : "Guard reset" });
        setNote("");
        void queryClient.invalidateQueries({ queryKey: getGetControlOutreachSendingQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListControlOutreachEmailsQueryKey() });
      },
      onError: (err: ErrorType<ErrorEnvelope>) =>
        toast({ title: "Could not change sending", description: apiErrorMessage(err), variant: "destructive" }),
    },
  });
  const state = sendingQuery.data;
  if (!state) return null;
  const { guard, dailyCap, health } = state;
  const noteOk = note.trim().length >= 5;
  const noteInput = (
    <input
      value={note}
      onChange={(e) => setNote(e.target.value)}
      placeholder="Note (required)"
      aria-label="Sending change note"
      maxLength={400}
      className="h-8 w-44 rounded-md border border-input bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  );

  if (guard.status === "paused") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 border-danger/40 p-4">
        <p className="text-sm text-danger">
          Sending is paused by the deliverability guard{guard.reason ? ` — ${guard.reason}` : ""}
          {guard.since ? ` (since ${fmt(guard.since)})` : ""}. Approvals will fail until an operator resets it.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {noteInput}
          <ActionButton
            tone="danger"
            disabled={!noteOk || setSending.isPending}
            onClick={() => setSending.mutate({ data: { paused: false, note: note.trim() } })}
          >
            {setSending.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Reset guard
          </ActionButton>
        </div>
      </Card>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="mono-label flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <Pill value={guard.status} />
        <span>
          cap {dailyCap.policyMax}/day · sent today {dailyCap.sentToday} · last {health.windowDays}d: {health.sent} sent,{" "}
          {health.bounced} bounced, {health.complained} complaints
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {noteInput}
        <ActionButton
          tone="neutral"
          disabled={!noteOk || setSending.isPending}
          title="Stop prospect sends until someone resets the guard"
          onClick={() => setSending.mutate({ data: { paused: true, note: note.trim() } })}
        >
          Pause sending
        </ActionButton>
      </div>
    </div>
  );
}

/* ————— Studio ————— */

export function OutreachStudioTab({ initialEmailId = null }: { initialEmailId?: number | null }) {
  const [filter, setFilter] = useState<ListFilter>(initialEmailId ? "all" : "awaiting");
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(initialEmailId);
  const params = filterParams(filter, offset);
  const listQuery = useListControlOutreachEmails(params, {
    query: { queryKey: getListControlOutreachEmailsQueryKey(params), refetchInterval: 20000 },
  });
  const rows = useMemo(() => listQuery.data?.emails ?? [], [listQuery.data]);
  // The server filters awaiting drafts; the client check keeps the list honest if it did not.
  const items = useMemo(() => (filter === "awaiting" ? rows.filter(isAwaiting) : rows), [rows, filter]);

  useEffect(() => {
    if (selectedId == null && items.length > 0) setSelectedId(items[0]!.email.id);
  }, [items, selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typingTarget(event.target)) return;
      if (event.key !== "j" && event.key !== "k") return;
      if (items.length === 0) return;
      const index = items.findIndex((item) => item.email.id === selectedId);
      const next = event.key === "j" ? Math.min(items.length - 1, index + 1) : Math.max(0, index - 1);
      setSelectedId(items[next]!.email.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedId]);

  return (
    <div className="space-y-4">
      <SendingBanner />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {LIST_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setOffset(0);
                setSelectedId(null);
              }}
              className={cn(
                "mono-label h-8 border px-3 transition-colors",
                filter === value ? "border-primary text-brand" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {value === "awaiting" ? "awaiting approval" : value}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Drafts come from the outreach agent or Pipeline. Approving sends through Resend. j / k to move.
        </p>
      </div>

      {listQuery.isLoading ? (
        <TabLoading />
      ) : items.length === 0 && selectedId == null ? (
        <EmptyState text="No studio emails here. The outreach agent drafts personal venue emails with the venue's own photos; use “Draft email” on a vetted prospect in Pipeline to start one by hand." />
      ) : (
        <div className="space-y-4">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Studio emails">
            {items.map((item) => (
              <button
                key={item.email.id}
                type="button"
                role="tab"
                aria-selected={selectedId === item.email.id}
                onClick={() => setSelectedId(item.email.id)}
                className={cn(
                  "w-56 shrink-0 border bg-card p-3 text-left transition-colors",
                  selectedId === item.email.id ? "border-primary" : "border-border hover:border-foreground/40",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Pill value={queueState(item)} />
                  <span className="mono-label text-muted-foreground">#{item.email.id}</span>
                </div>
                <p className="mt-2 truncate text-sm font-medium text-foreground">{item.prospect.name}</p>
                <VettingBadge status={item.prospect.vettingStatus} score={null} className="mt-1" />
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.email.subject}</p>
                <p className="mono-label mt-2 text-muted-foreground">
                  {item.imageCount} photo{item.imageCount === 1 ? "" : "s"} · {fmt(item.email.updatedAt)}
                  {item.email.lastError && item.email.status === "draft" ? " · send held" : ""}
                </p>
              </button>
            ))}
            {offset > 0 || rows.length === PAGE_SIZE ? (
              <div className="flex shrink-0 flex-col justify-center gap-1.5">
                <ActionButton tone="neutral" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Newer
                </ActionButton>
                <ActionButton tone="neutral" disabled={rows.length < PAGE_SIZE} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Older
                </ActionButton>
              </div>
            ) : null}
          </div>
          {selectedId != null ? <EmailReview emailId={selectedId} /> : null}
        </div>
      )}
    </div>
  );
}

type Device = "desktop" | "mobile";
type Scheme = "light" | "dark";

function EmailReview({ emailId }: { emailId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const detailQuery = useGetControlOutreachEmail(emailId, {
    query: { queryKey: getGetControlOutreachEmailQueryKey(emailId) },
  });
  const detail = detailQuery.data?.detail;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetControlOutreachEmailQueryKey(emailId) });
    void queryClient.invalidateQueries({ queryKey: getListControlOutreachEmailsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlActionsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetControlOverviewQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListControlProspectsQueryKey() });
  };
  const onError = (title: string) => (err: ErrorType<ErrorEnvelope>) =>
    toast({ title, description: apiErrorMessage(err), variant: "destructive" });

  const update = useUpdateControlOutreachEmail({
    mutation: { onSuccess: () => { toast({ title: "Draft saved" }); invalidate(); }, onError: onError("Could not save") },
  });
  const regenerate = useRegenerateControlOutreachEmail({
    mutation: { onSuccess: () => { toast({ title: "Draft regenerated" }); invalidate(); }, onError: onError("Could not regenerate") },
  });
  const decide = useDecideControlAction({
    mutation: {
      onSuccess: (data) => {
        toast({
          title:
            data.action.status === "executed"
              ? "Approved and sent"
              : data.action.status === "failed"
                ? "Approved, but the send failed"
                : `Action ${data.action.status}`,
          description: data.action.error ?? undefined,
          variant: data.action.status === "failed" ? "destructive" : undefined,
        });
        invalidate();
      },
      onError: onError("Decision failed"),
    },
  });

  if (detailQuery.isLoading) return <TabLoading />;
  if (!detail) return <EmptyState text="Could not load this email." />;

  return (
    <EmailReviewBody
      key={`${detail.email.id}:${detail.email.updatedAt}`}
      detail={detail}
      busy={update.isPending || regenerate.isPending || decide.isPending}
      onSave={(data) => update.mutate({ id: emailId, data })}
      onRegenerate={(mode) => regenerate.mutate({ id: emailId, data: { mode } })}
      onDecide={(decision, note) => {
        if (!detail.action) return;
        // `reviewed` marks an approval made here, after the rendered email was on screen;
        // the server refuses send_outreach_email approvals without it.
        const data: ControlActionDecisionBody = { decision, note: note || undefined, reviewed: true };
        decide.mutate({ id: detail.action.id, data });
      }}
    />
  );
}

function EmailReviewBody({
  detail,
  busy,
  onSave,
  onRegenerate,
  onDecide,
}: {
  detail: ControlOutreachEmailDetail;
  busy: boolean;
  onSave: (data: {
    subject?: string;
    body?: string;
    greeting?: string;
    signOff?: string;
    ctaLabel?: string;
    ctaUrl?: string;
    imageAssetIds?: number[];
  }) => void;
  onRegenerate: (mode: "copy" | "research" | "both") => void;
  onDecide: (decision: "approve" | "reject", note: string) => void;
}) {
  const { email, prospect, action, research, assets, preview, warnings, editable } = detail;
  const [device, setDevice] = useState<Device>("desktop");
  const [scheme, setScheme] = useState<Scheme>("light");
  const [showText, setShowText] = useState(false);
  const [subject, setSubject] = useState(email.subject);
  const [greeting, setGreeting] = useState(email.greeting);
  const [body, setBody] = useState(email.body);
  const [signOff, setSignOff] = useState(email.signOff);
  const [ctaLabel, setCtaLabel] = useState(email.ctaLabel);
  const [ctaUrl, setCtaUrl] = useState(email.ctaUrl);
  const [imageIds, setImageIds] = useState<number[]>(email.imageAssetIds);
  const [note, setNote] = useState("");

  const dirty =
    subject !== email.subject ||
    greeting !== email.greeting ||
    body !== email.body ||
    signOff !== email.signOff ||
    ctaLabel !== email.ctaLabel ||
    ctaUrl !== email.ctaUrl ||
    imageIds.join(",") !== email.imageAssetIds.join(",");
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const awaiting = email.status === "draft" && (action?.status ?? "pending") === "pending";
  const allWarnings = [...warnings.vetting, ...warnings.research, ...warnings.config];
  const violations = copyViolations(email.draftNotes);
  const citedFacts = email.citedFacts ?? [];
  const citableKinds = new Set(["space", "location", "capacity", "owner_name"]);
  const citedKeys = new Set(citedFacts.map((fact) => `${fact.kind}:${fact.value}`));
  const uncited = detail.facts.filter(
    (fact) => fact.status === "verified" && citableKinds.has(fact.kind) && !citedKeys.has(`${fact.kind}:${fact.value}`),
  );
  const overrideOk = note.trim().length >= OVERRIDE_NOTE_MIN;
  const blockedByFlags = violations.length > 0 && !overrideOk;
  const retry = awaiting && Boolean(email.lastError);
  const approveTitle = dirty
    ? "Save your edits first"
    : !detail.approvable
      ? detail.vetting?.status !== "passed"
        ? "Vetting has not passed for this venue"
        : citedFacts.length < 2
          ? "The copy must cite at least two verified venue facts"
          : "Sending is blocked (see warnings)"
      : blockedByFlags
        ? "The draft breaks copy rules; fix it or write why you are sending it anyway"
        : retry
          ? "Try the send again now that the problem is fixed"
          : "Approve and send through Resend";

  const toggleImage = (asset: ControlOutreachAsset) => {
    setImageIds((current) =>
      current.includes(asset.id)
        ? current.filter((id) => id !== asset.id)
        : current.length >= 3
          ? current
          : [...current, asset.id],
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Pill value={email.status} />
              {action ? <Pill value={action.status} /> : null}
              <span className="mono-label text-muted-foreground">
                email #{email.id}
                {action ? ` · action #${action.id}` : ""} · {email.createdByAgent ?? "operator"} · {fmt(email.createdAt)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="font-display text-xl text-foreground">{prospect.name}</p>
              <VettingBadge status={detail.vetting?.status ?? prospect.vettingStatus ?? "unvetted"} score={detail.vetting?.score ?? null} />
            </div>
            <p className="text-xs text-muted-foreground">
              {prospect.contactName ? `${prospect.contactName} · ` : ""}
              {prospect.email}
              {prospect.website ? (
                <>
                  {" · "}
                  <a href={prospect.website} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                    {prospect.website.replace(/^https?:\/\/(www\.)?/, "")}
                  </a>
                </>
              ) : null}
              {" · "}
              {prospect.contactCount} prior email{prospect.contactCount === 1 ? "" : "s"}
            </p>
          </div>
          {awaiting && action ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={violations.length > 0 ? "Why send despite the flags (required)" : "Decision note (optional)"}
                aria-label="Decision note"
                maxLength={500}
                className="h-8 w-56 border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <ActionButton
                tone="primary"
                disabled={busy || dirty || !detail.approvable || blockedByFlags}
                title={approveTitle}
                onClick={() => onDecide("approve", violations.length > 0 ? `override: ${note.trim()}` : note)}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {retry ? "Retry send" : "Approve and send"}
              </ActionButton>
              <ActionButton tone="danger" disabled={busy} onClick={() => onDecide("reject", note)}>
                Reject
              </ActionButton>
            </div>
          ) : email.status === "draft" && action?.status === "approved" ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {email.lastError ? `Waiting to retry: ${email.lastError}` : "Sending in about two minutes."}
              </p>
              <ActionButton tone="danger" disabled={busy} onClick={() => onDecide("reject", "cancelled before sending")}>
                Cancel send
              </ActionButton>
            </div>
          ) : action?.decidedBy ? (
            <p className="text-xs text-muted-foreground">
              {action.status} by {action.decidedBy}
              {action.decisionNote ? ` — ${action.decisionNote}` : ""}
              {email.sentAt ? ` · sent ${fmt(email.sentAt)}` : ""}
              {email.deliveredAt ? ` · delivered ${fmt(email.deliveredAt)}` : ""}
              {email.bounceReason ? ` · bounce: ${email.bounceReason}` : ""}
            </p>
          ) : null}
        </div>
        {allWarnings.length > 0 ? (
          <ul className="mt-3 space-y-1 border-t border-border pt-3">
            {allWarnings.map((warning) => (
              <li key={warning} className="flex gap-2 text-xs leading-relaxed text-warning">
                <span aria-hidden>▲</span>
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {violations.length > 0 ? (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mono-label text-danger">Copy rules broken ({violations.length})</p>
            <ul className="mt-1 space-y-1">
              {violations.map((violation) => (
                <li key={violation} className="flex gap-2 text-xs leading-relaxed text-danger">
                  <span aria-hidden>✕</span>
                  <span>{violation}</span>
                </li>
              ))}
            </ul>
            {awaiting ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Edit or rewrite the draft, or type why it should go anyway; the note is saved with the approval.
              </p>
            ) : null}
          </div>
        ) : null}
        {email.lastError ? (
          <p className="mt-3 text-xs text-danger">
            {awaiting ? "The last send attempt was held: " : ""}
            {email.lastError}
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Preview */}
        <Card className="min-w-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <ToggleButton active={device === "desktop" && !showText} onClick={() => { setDevice("desktop"); setShowText(false); }} label="Desktop">
                <Monitor className="h-3.5 w-3.5" />
              </ToggleButton>
              <ToggleButton active={device === "mobile" && !showText} onClick={() => { setDevice("mobile"); setShowText(false); }} label="Mobile">
                <Smartphone className="h-3.5 w-3.5" />
              </ToggleButton>
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <ToggleButton active={scheme === "light"} onClick={() => setScheme("light")} label="Light">
                <Sun className="h-3.5 w-3.5" />
              </ToggleButton>
              <ToggleButton active={scheme === "dark"} onClick={() => setScheme("dark")} label="Dark">
                <Moon className="h-3.5 w-3.5" />
              </ToggleButton>
              <span aria-hidden className="mx-1 h-4 w-px bg-border" />
              <ToggleButton active={showText} onClick={() => setShowText((v) => !v)} label="Plain text">
                <FileText className="h-3.5 w-3.5" />
              </ToggleButton>
            </div>
            <p className="mono-label min-w-0 flex-1 truncate text-muted-foreground sm:text-right">
              {dirty ? "preview shows the saved version" : `subject: ${email.subject}`}
            </p>
          </div>
          <div className={cn("flex justify-center overflow-x-auto p-4", scheme === "dark" ? "bg-[#0d1110]" : "bg-[#e9e7df]")}>
            {showText ? (
              <pre className="w-full max-w-[640px] whitespace-pre-wrap border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground/90">
                {preview.text}
              </pre>
            ) : (
              <iframe
                title={`Email preview (${device}, ${scheme})`}
                sandbox=""
                srcDoc={scheme === "dark" ? preview.htmlDark : preview.html}
                style={{ width: device === "mobile" ? 390 : 660, height: 860, maxWidth: "100%" }}
                className="shrink-0 border-0 bg-transparent"
              />
            )}
          </div>
          <div className="border-t border-border px-4 py-2 font-mono text-[11px] text-muted-foreground">
            {Object.entries(preview.headers).map(([key, value]) => (
              <p key={key} className="truncate">
                {key}: {value}
              </p>
            ))}
          </div>
        </Card>

        {/* Editor */}
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className={cn("mono-label", subject.length > SUBJECT_MAX ? "text-danger" : "text-muted-foreground")}>
                Subject ({subject.length}/{SUBJECT_MAX})
              </h3>
              {editable ? (
                <ActionButton tone="neutral" disabled={busy} onClick={() => onRegenerate("copy")} title="Ask Grok for a fresh draft">
                  <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} /> Rewrite
                </ActionButton>
              ) : null}
            </div>
            <div className="space-y-1.5">
              {email.subjectOptions.map((option) => (
                <label key={option} className="flex cursor-pointer items-start gap-2 text-sm text-foreground/90">
                  <input
                    type="radio"
                    name={`subject-${email.id}`}
                    checked={subject === option}
                    disabled={!editable}
                    onChange={() => setSubject(option)}
                    className="mt-1 accent-current"
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
            <input
              value={subject}
              disabled={!editable}
              maxLength={SUBJECT_MAX}
              aria-label="Subject"
              onChange={(e) => setSubject(e.target.value)}
              className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
            />
          </Card>

          <Card className="space-y-3">
            <h3 className="mono-label text-muted-foreground">Copy ({wordCount} words)</h3>
            <input
              value={greeting}
              disabled={!editable}
              onChange={(e) => setGreeting(e.target.value)}
              className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
            />
            <textarea
              value={body}
              disabled={!editable}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full resize-y border border-border bg-background p-3 text-sm leading-relaxed text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
            />
            <textarea
              value={signOff}
              disabled={!editable}
              onChange={(e) => setSignOff(e.target.value)}
              rows={2}
              className="w-full resize-none border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
            />
            <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr]">
              <input
                value={ctaLabel}
                disabled={!editable}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Button text"
                className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
              />
              <input
                value={ctaUrl}
                disabled={!editable}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https:// or mailto:"
                className="h-9 w-full border border-border bg-background px-3 font-mono text-xs text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
              />
            </div>
            {email.draftNotes ? (
              <p className="text-xs text-muted-foreground">
                Draft source: {String((email.draftNotes as Record<string, unknown>).source ?? "unknown")}
                {Number((email.draftNotes as Record<string, unknown>).attempts ?? 0) > 1 ? " (after a rewrite)" : ""}
                {` · cites ${citedFacts.length} fact${citedFacts.length === 1 ? "" : "s"}`}
              </p>
            ) : null}
          </Card>

          <Card className="space-y-2">
            <h3 className={cn("mono-label", citedFacts.length < 2 ? "text-danger" : "text-muted-foreground")}>
              Facts in this email ({citedFacts.length}/{citedFacts.length + uncited.length})
            </h3>
            {citedFacts.length > 0 ? (
              <ul className="space-y-1">
                {citedFacts.map((fact) => (
                  <li key={`${fact.kind}:${fact.value}`} className="text-xs text-foreground/90">
                    <span className="mono-label mr-1.5 text-muted-foreground">{fact.kind.replace(/_/g, " ")}</span>
                    {fact.value} ·{" "}
                    <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground underline hover:text-foreground">
                      source
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            {citedFacts.length < 2 ? (
              <p className="text-xs text-danger">Two verified facts are required before this can send.</p>
            ) : null}
            {uncited.length > 0 ? (
              <div className="space-y-0.5 text-xs text-muted-foreground">
                <p>Mention one of these to strengthen the note:</p>
                {uncited.map((fact) => (
                  <p key={fact.id}>
                    {fact.kind.replace(/_/g, " ")} · {fact.value}
                  </p>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="mono-label text-muted-foreground">Photos ({imageIds.length}/3 in email)</h3>
              {editable ? (
                <ActionButton tone="neutral" disabled={busy} onClick={() => onRegenerate("research")} title="Fetch the venue site again">
                  <RefreshCw className={cn("h-3 w-3", busy && "animate-spin")} /> Re-fetch
                </ActionButton>
              ) : null}
            </div>
            {assets.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No photos were found on the venue's site. The email goes out as a text-only note.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {assets.map((asset) => {
                  const position = imageIds.indexOf(asset.id);
                  return (
                    <figure key={asset.id} className={cn("min-w-0 border bg-background", position >= 0 ? "border-primary/70" : "border-border")}>
                      <button
                        type="button"
                        disabled={!editable}
                        onClick={() => toggleImage(asset)}
                        className="relative block w-full disabled:cursor-default"
                        aria-pressed={position >= 0}
                        aria-label={position >= 0 ? `Remove photo ${asset.id} from the email` : `Add photo ${asset.id} to the email`}
                      >
                        <img src={asset.url} alt={asset.altText} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                        {position >= 0 ? (
                          <span className="absolute left-1.5 top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-brand-foreground">
                            {position === 0 ? "hero" : position + 1}
                          </span>
                        ) : null}
                        {asset.kind === "sample_preview" ? (
                          <span className="absolute right-1.5 top-1.5 bg-background/90 px-1.5 py-0.5 text-[10px] text-foreground">sample</span>
                        ) : null}
                      </button>
                      <figcaption className="space-y-0.5 p-2 text-[11px] leading-snug text-muted-foreground">
                        <p className="truncate text-foreground/80" title={asset.altText}>{asset.altText}</p>
                        <p>
                          {asset.width}×{asset.height} · {Math.round(asset.bytes / 1024)} KB
                        </p>
                        {asset.sourceUrl ? (
                          <a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="flex min-w-0 max-w-full items-center gap-1 underline hover:text-foreground">
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{asset.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</span>
                          </a>
                        ) : null}
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </Card>

          {research ? (
            <Card className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="mono-label text-muted-foreground">What the site says</h3>
                <Pill value={research.status} />
              </div>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="text-foreground/90">{research.facts.name ?? "—"}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd className="text-foreground/90">{research.facts.location ?? "—"}</dd>
                <dt className="text-muted-foreground">Spaces</dt>
                <dd className="text-foreground/90">{research.facts.spaces.length > 0 ? research.facts.spaces.join(", ") : "—"}</dd>
                <dt className="text-muted-foreground">Capacity</dt>
                <dd className="text-foreground/90">{research.facts.capacity ? `${research.facts.capacity} guests` : "—"}</dd>
                <dt className="text-muted-foreground">Style</dt>
                <dd className="text-foreground/90">{research.facts.style ?? "—"}</dd>
              </dl>
              <div className="border-t border-border pt-2">
                <p className="mono-label mb-1 flex flex-wrap justify-between gap-2 text-muted-foreground">
                  <span>Sources · fetched {fmt(research.fetchedAt)}</span>
                  <a href="#pipeline" className="underline hover:text-foreground">
                    Open evidence in Pipeline
                  </a>
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
              </div>
            </Card>
          ) : null}

          {editable ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {dirty ? <span className="text-xs text-warning">Unsaved edits</span> : null}
              <ActionButton
                tone="primary"
                disabled={busy || !dirty}
                onClick={() =>
                  onSave({
                    ...(subject !== email.subject ? { subject } : {}),
                    ...(greeting !== email.greeting ? { greeting } : {}),
                    ...(body !== email.body ? { body } : {}),
                    ...(signOff !== email.signOff ? { signOff } : {}),
                    ...(ctaLabel !== email.ctaLabel ? { ctaLabel } : {}),
                    ...(ctaUrl !== email.ctaUrl ? { ctaUrl } : {}),
                    ...(imageIds.join(",") !== email.imageAssetIds.join(",") ? { imageAssetIds: imageIds } : {}),
                  })
                }
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Save changes
              </ActionButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 border px-2.5 text-xs transition-colors",
        active ? "border-primary text-brand" : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
