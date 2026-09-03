import { useRef, useState, type FormEvent } from "react";
import type { SessionSummary } from "@workspace/api-client-react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  Image as ImageIcon,
  ImageUp,
  Loader2,
  Mail,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { FrameTicks } from "@/components/motion";
import { formatRelativeDay } from "@/lib/copy";
import { cn } from "@/lib/utils";
import { MAX_COUPLE_PHOTOS, MIN_COUPLE_PHOTOS, ownerAssetUrl } from "./types";

export type NewGalleryDraft = {
  coupleName: string;
  coupleEmail: string;
  files: File[];
  previews: string[];
};

type Props = {
  sessions: SessionSummary[];
  venueReady: boolean;
  creditsBalance: number;
  sendingSessionId: number | null;
  sentSessionId: number | null;
  deletingSessionId: number | null;
  onSend: (sessionId: number, coupleEmail?: string | null) => void;
  onDelete: (sessionId: number) => void;
  onOpen: (shareToken?: string | null) => void;
  // New-gallery intake
  draft: NewGalleryDraft;
  onDraftChange: (patch: Partial<NewGalleryDraft>) => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  onStart: () => Promise<void> | void;
  isStarting: boolean;
  intakeOpen: boolean;
  onIntakeOpenChange: (open: boolean) => void;
  onBuyCredits: () => void;
};

export function GalleriesSection(props: Props) {
  const { sessions, venueReady, creditsBalance, intakeOpen, onIntakeOpenChange } = props;
  const [pendingDelete, setPendingDelete] = useState<SessionSummary | null>(null);
  const deleteTrigger = useRef<HTMLElement | null>(null);
  const ready = sessions.filter((s) => s.status === "ready").length;

  return (
    <section aria-labelledby="galleries-title" className="border-t border-border pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono-label mb-3 text-rose">Galleries</p>
          <h2 id="galleries-title" className="font-display text-2xl font-medium tracking-tight md:text-3xl">
            {sessions.length === 0
              ? "No galleries yet"
              : `${sessions.length} ${sessions.length === 1 ? "gallery" : "galleries"}`}
            {ready > 0 && sessions.length !== ready && (
              <span className="text-muted-foreground"> · {ready} ready</span>
            )}
          </h2>
        </div>
        <Button
          type="button"
          variant={intakeOpen ? "outline" : "rose"}
          onClick={() => onIntakeOpenChange(!intakeOpen)}
          aria-expanded={intakeOpen}
          aria-controls="new-gallery-panel"
          className="h-11 px-5"
          data-testid="owner-new-gallery"
        >
          {intakeOpen ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {intakeOpen ? "Close" : "New gallery"}
        </Button>
      </div>

      {intakeOpen && (
        <NewGalleryPanel
          {...props}
          disabledReason={
            !venueReady
              ? "Add a venue photo first — galleries are rendered in your real spaces."
              : creditsBalance <= 0
                ? "No credits left. Buy a credit pack to start this gallery."
                : null
          }
        />
      )}

      <div className="mt-6">
        {sessions.length === 0 ? (
          <div className="border border-dashed border-border px-6 py-12 text-center">
            <p className="font-display text-xl">Your first gallery arrives with your first couple.</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Hand them your link after the tour, or start one here with their photos.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {sessions.map((session) => (
              <GalleryRow
                key={session.id}
                session={session}
                sending={props.sendingSessionId === session.id}
                sent={props.sentSessionId === session.id}
                deleting={props.deletingSessionId === session.id}
                onOpen={() => props.onOpen(session.shareToken)}
                onSend={() => props.onSend(session.id, session.coupleEmail)}
                onDelete={(el) => {
                  deleteTrigger.current = el;
                  setPendingDelete(session);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent
          onCloseAutoFocus={(e) => {
            // Opened programmatically (no DialogTrigger), so hand focus back ourselves.
            e.preventDefault();
            deleteTrigger.current?.focus();
          }}
        >
          <DialogTitle>Delete this gallery?</DialogTitle>
          <DialogDescription>
            {pendingDelete?.coupleName ? `${pendingDelete.coupleName}'s gallery` : "This gallery"}, its
            photos, and its share link are removed for good. The couple's link stops working.
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDelete(null)} className="h-10">
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-10"
              onClick={() => {
                if (pendingDelete) props.onDelete(pendingDelete.id);
                setPendingDelete(null);
              }}
              data-testid="confirm-delete-gallery"
            >
              <Trash2 className="h-4 w-4" /> Delete gallery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function GalleryRow({
  session,
  sending,
  sent,
  deleting,
  onOpen,
  onSend,
  onDelete,
}: {
  session: SessionSummary;
  sending: boolean;
  sent: boolean;
  deleting: boolean;
  onOpen: () => void;
  onSend: () => void;
  onDelete: (trigger: HTMLElement) => void;
}) {
  const canOpen = Boolean(session.shareToken);
  const canSend = session.status === "ready" && Boolean(session.coupleEmail);
  const when = formatRelativeDay(session.createdAt);

  return (
    <li
      className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4 sm:grid-cols-[64px_minmax(0,1fr)_auto]"
      data-testid={`gallery-row-${session.id}`}
    >
      <div className="relative aspect-square overflow-hidden border border-border bg-secondary">
        {session.thumbnailObjectKey ? (
          <img
            src={ownerAssetUrl(session.thumbnailObjectKey)}
            alt=""
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {session.status === "failed" ? (
              <AlertCircle className="h-5 w-5 text-red-400" />
            ) : session.status === "ready" ? (
              <ImageIcon className="h-5 w-5" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-rose" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="min-w-0 break-words font-display text-lg font-medium leading-tight">
            {session.coupleName || "Unnamed couple"}
          </p>
          <StatusPill status={session.status} />
        </div>
        <p className="mt-1 min-w-0 break-all text-sm text-muted-foreground">
          {session.coupleEmail || "No email on file"}
          <span aria-hidden> · </span>
          <span className="whitespace-nowrap">{when}</span>
        </p>
        {session.status === "failed" && (
          <p className="mt-1 text-sm text-red-300">
            Didn't finish. The credit was returned — try again with sharper, well-lit photos of both faces.
          </p>
        )}
      </div>

      <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
        {canSend && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={sending || sent}
            onClick={onSend}
            className={cn("h-9", sent && "border-emerald-400/30 text-emerald-300 disabled:opacity-100")}
            data-testid={`send-gallery-${session.id}`}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : sent ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
            {sent ? "Sent" : "Email couple"}
          </Button>
        )}
        {canOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpen}
            className="h-9"
            data-testid={`view-gallery-${session.id}`}
          >
            <ExternalLink className="h-4 w-4" />
            Open
          </Button>
        )}
        <button
          type="button"
          onClick={(e) => onDelete(e.currentTarget)}
          disabled={deleting}
          aria-label={`Delete ${session.coupleName || "this"} gallery`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          data-testid={`delete-gallery-${session.id}`}
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </li>
  );
}

function NewGalleryPanel({
  draft,
  onDraftChange,
  onAddFiles,
  onRemoveFile,
  onStart,
  isStarting,
  disabledReason,
  onBuyCredits,
  creditsBalance,
}: Props & { disabledReason: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const canStart =
    !disabledReason &&
    !isStarting &&
    draft.files.length >= MIN_COUPLE_PHOTOS &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.coupleEmail.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canStart) void onStart();
  };

  return (
    <form
      id="new-gallery-panel"
      onSubmit={submit}
      className="mt-6 border border-card-border bg-card p-5 sm:p-6"
      aria-label="Start a gallery for a couple"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="couple-email" className="mono-label text-muted-foreground">
              Couple's email
            </Label>
            <Input
              id="couple-email"
              type="email"
              required
              autoComplete="off"
              inputMode="email"
              value={draft.coupleEmail}
              onChange={(e) => onDraftChange({ coupleEmail: e.target.value })}
              className="h-11 border-border bg-background px-4"
              placeholder="avery@example.com"
              data-testid="owner-couple-email"
            />
            <p className="text-xs text-muted-foreground">The finished gallery link goes here.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="couple-name" className="mono-label text-muted-foreground">
              Their names <span className="normal-case tracking-normal">(optional)</span>
            </Label>
            <Input
              id="couple-name"
              value={draft.coupleName}
              onChange={(e) => onDraftChange({ coupleName: e.target.value })}
              className="h-11 border-border bg-background px-4"
              placeholder="Avery & Jordan"
              maxLength={80}
              data-testid="owner-couple-name"
            />
          </div>
        </div>

        <div>
          <p className="mono-label text-muted-foreground">Their photos</p>
          <p className="mt-1 text-xs text-muted-foreground">
            One to three. Faces clear and well lit — one together, then one of each.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              onAddFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
            data-testid="owner-couple-photo-input"
          />
          <div className="mt-3 grid grid-cols-3 gap-3">
            {Array.from({ length: MAX_COUPLE_PHOTOS }, (_, slot) => {
              const preview = draft.previews[slot];
              const label = ["Together", "Partner A", "Partner B"][slot];
              return preview ? (
                <div key={slot} className="group relative aspect-square overflow-hidden border border-rose/60 bg-background">
                  <img src={preview} alt={`${label} photo`} className="h-full w-full object-cover" />
                  <FrameTicks size={12} className="text-white/70" />
                  <button
                    type="button"
                    onClick={() => onRemoveFile(slot)}
                    aria-label={`Remove ${label} photo`}
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <span className="mono-label absolute bottom-1.5 left-2 text-white drop-shadow">{label}</span>
                </div>
              ) : (
                <button
                  key={slot}
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={draft.files.length >= MAX_COUPLE_PHOTOS}
                  className={cn(
                    "mono-label flex aspect-square flex-col items-center justify-center gap-2 border border-dashed border-border bg-background text-muted-foreground transition-colors",
                    "hover:border-rose hover:text-rose focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  )}
                  aria-label={`Add ${label} photo`}
                >
                  <ImageUp className="h-5 w-5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {disabledReason ?? (
            <>
              Uses 1 of your <span className="text-foreground">{creditsBalance}</span> credits. We email you and
              the couple when it's ready.
            </>
          )}
        </p>
        {disabledReason && creditsBalance <= 0 ? (
          <Button type="button" variant="rose" onClick={onBuyCredits} className="h-11 px-6">
            Buy credits
          </Button>
        ) : (
          <Button
            type="submit"
            variant="rose"
            disabled={!canStart}
            className="h-11 px-6"
            data-testid="owner-start-gallery"
          >
            {isStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isStarting ? "Starting…" : "Start gallery"}
          </Button>
        )}
      </div>
    </form>
  );
}
