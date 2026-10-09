import { Fragment, useState } from "react";
import {
  CalendarCheck,
  ChevronDown,
  ChevronUp,
  Eye,
  Image as ImageIcon,
  Loader2,
  Mail,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  getGetSessionQueryKey,
  useCreateSampleGallery,
  useDeleteSession,
  useGetSession,
  useSendSessionEmail,
  useSetSessionBooked,
  type SessionSummary,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage, isFeatureUnavailable } from "./errors";
import {
  formatWeddingMonth,
  galleryStage,
  qualityNote,
  sessionFunnel,
  shortDate,
  sourceLabel,
  summarizeGalleries,
} from "./galleryStats";
import { ownerAssetUrl } from "./storageUrls";
import type { DashboardContext } from "./types";
import { Note, SectionHead, StatusPill, Tag } from "./ui";

/**
 * Every couple gallery with what happened after it was sent: viewed,
 * clicked for a date, booked. One click marks a couple as booked, which is
 * the number a venue renews on. Failed galleries explain themselves.
 */
export function GalleryList({ ctx }: { ctx: DashboardContext }) {
  const { sessions } = ctx;
  const stats = summarizeGalleries(sessions);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);

  return (
    <section className="dash-section" aria-labelledby="galleries-title">
      <SectionHead
        id="galleries-title"
        title="Couple galleries"
        description="Preview each gallery, send it, and mark the couple as booked when they sign. Booked dates are how you'll know it works."
        aside={
          sessions.length > 0 ? (
            <Button type="button" variant="outline" onClick={() => ctx.goTo("new")} data-testid="galleries-create">
              <Sparkles className="h-4 w-4" /> Create a gallery
            </Button>
          ) : null
        }
      />

      {stats.couples > 0 ? <ProofStrip stats={stats} /> : null}

      {sessions.length === 0 ? (
        <EmptyGalleries ctx={ctx} />
      ) : (
        <ul className="gallery-list" aria-label="Galleries">
          {sessions.map((session) => (
            <GalleryRow key={session.id} ctx={ctx} session={session} onDelete={() => setDeleteTarget(session)} />
          ))}
        </ul>
      )}

      <DeleteDialog ctx={ctx} target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </section>
  );
}

function ProofStrip({ stats }: { stats: ReturnType<typeof summarizeGalleries> }) {
  const cells: Array<{ label: string; value: number; note?: string }> = [
    { label: "Galleries", value: stats.couples },
    { label: "Sent", value: stats.sent },
    { label: "Viewed", value: stats.viewed },
    { label: "Clicked for a date", value: stats.clicked },
    { label: "Booked", value: stats.booked, note: stats.bookedRate !== null ? `${stats.bookedRate}% of ready` : undefined },
  ];
  return (
    <div className="proof-strip" role="list" aria-label="What couples did with their galleries" data-testid="proof-strip">
      {cells.map((cell) => (
        <div key={cell.label} role="listitem">
          <span className="eyebrow text-muted-foreground">{cell.label}</span>
          <strong>{cell.value}</strong>
          {cell.note ? <span className="text-xs text-muted-foreground">{cell.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

function EmptyGalleries({ ctx }: { ctx: DashboardContext }) {
  const { toast } = useToast();
  const sample = useCreateSampleGallery();
  const [sampleUnavailable, setSampleUnavailable] = useState(false);

  const runSample = async () => {
    try {
      await sample.mutateAsync({ slug: ctx.slug });
      toast({ title: "Sample started", description: "A gallery of our demo couple at your venue. It does not use a credit." });
      void ctx.refreshDashboard();
    } catch (err) {
      if (isFeatureUnavailable(err)) {
        setSampleUnavailable(true);
        return;
      }
      toast({ title: "The sample did not start", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  return (
    <div className="dash-card grid justify-items-start gap-4" data-testid="galleries-empty">
      <div>
        <h3 className="font-display text-xl font-semibold">No galleries yet</h3>
        <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Make one for the next couple who tours. Or see the result first with our demo couple at{" "}
          {ctx.venue.name}; a sample does not use a credit.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => ctx.goTo("new")}>
          <Sparkles className="h-4 w-4" /> Create a gallery
        </Button>
        {!sampleUnavailable ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void runSample()}
            disabled={sample.isPending || !ctx.readiness.ready}
            title={ctx.readiness.ready ? undefined : "Add your five venue photos first"}
            data-testid="galleries-sample"
          >
            {sample.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Render a sample
          </Button>
        ) : null}
      </div>
      {sampleUnavailable ? (
        <p className="field-hint" role="status">
          Samples are not switched on for this server yet.
        </p>
      ) : !ctx.readiness.ready ? (
        <p className="field-hint">Add your five venue photos first; every gallery is built from them.</p>
      ) : null}
    </div>
  );
}

function GalleryRow({
  ctx,
  session,
  onDelete,
}: {
  ctx: DashboardContext;
  session: SessionSummary;
  onDelete: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(session.status === "failed");
  const send = useSendSessionEmail();
  const booked = useSetSessionBooked();
  const stage = galleryStage(session.status);
  const isSample = session.kind === "sample";
  const funnel = sessionFunnel(session);
  const month = formatWeddingMonth(session.weddingMonth);
  const name = session.coupleName?.trim() || (isSample ? "Demo couple" : "Couple");
  const canSend = stage === "ready" && !isSample && Boolean(session.coupleEmail);
  const canBook = !isSample && stage === "ready";

  const handleSend = async () => {
    try {
      await send.mutateAsync({ id: session.id, data: {} });
      toast({ title: "Gallery sent", description: session.coupleEmail ? `Emailed to ${session.coupleEmail}.` : undefined });
      void ctx.refreshDashboard();
    } catch (err) {
      toast({ title: "The email did not send", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  const handleBooked = async (next: boolean) => {
    try {
      await booked.mutateAsync({ slug: ctx.slug, id: session.id, data: { booked: next } });
      toast({
        title: next ? `${name} marked as booked` : "Booking mark removed",
        description: next ? "It counts toward your booked dates." : undefined,
      });
      void ctx.refreshDashboard();
    } catch (err) {
      toast({
        title: next ? "Could not mark as booked" : "Could not undo",
        description: isFeatureUnavailable(err)
          ? "Booking marks are not switched on for this server yet."
          : apiErrorMessage(err, "Try again."),
        variant: "destructive",
      });
    }
  };

  return (
    <li className="gallery-row" data-stage={stage} data-testid={`gallery-row-${session.id}`}>
      <div className="gallery-thumb" aria-hidden="true">
        {session.thumbnailObjectKey ? (
          <img
            src={ownerAssetUrl(session.thumbnailObjectKey)}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <ImageIcon className="h-5 w-5" />
        )}
      </div>

      <div className="gallery-row-main">
        <div className="gallery-row-title">
          <strong>{name}</strong>
          <StatusPill status={session.status} />
          {isSample ? <Tag tone="sample">Sample</Tag> : null}
        </div>
        <div className="gallery-row-meta">
          <span>{shortDate(session.createdAt)}</span>
          <span>{sourceLabel(session.createdVia, session.kind)}</span>
          {month ? <span>Wedding {month}</span> : null}
          {session.coupleEmail ? <span>{session.coupleEmail}</span> : null}
        </div>
        {!isSample && stage === "ready" ? (
          <div className="funnel-chips" role="list" aria-label="What the couple did">
            {funnel.map((chip, i) => (
              <Fragment key={chip.key}>
                {i > 0 ? (
                  <span className="funnel-arrow" aria-hidden="true">
                    →
                  </span>
                ) : null}
                <span role="listitem" className="funnel-chip" data-done={chip.done ? "true" : "false"} data-key={chip.key}>
                  {chip.label}
                  {chip.detail ? <small>{chip.detail}</small> : null}
                  <span className="sr-only">{chip.done ? " (yes)" : " (not yet)"}</span>
                </span>
              </Fragment>
            ))}
          </div>
        ) : null}
      </div>

      <div className="gallery-actions">
        {session.shareToken && stage === "ready" ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/v/${session.shareToken}`} target="_blank" rel="noopener noreferrer" data-testid={`view-gallery-${session.id}`}>
              <Eye className="h-4 w-4" /> Preview
            </a>
          </Button>
        ) : null}
        {canSend ? (
          <Button
            type="button"
            variant={session.emailedAt ? "ghost" : "outline"}
            size="sm"
            onClick={() => void handleSend()}
            disabled={send.isPending}
            data-testid={`send-gallery-${session.id}`}
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            {session.emailedAt ? "Send again" : "Email gallery"}
          </Button>
        ) : null}
        {canBook ? (
          session.bookedAt ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleBooked(false)}
              disabled={booked.isPending}
              aria-label={`Undo booked mark for ${name}`}
              data-testid={`unbook-gallery-${session.id}`}
            >
              {booked.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Undo booked
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void handleBooked(true)}
              disabled={booked.isPending}
              data-testid={`book-gallery-${session.id}`}
            >
              {booked.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Mark as booked
            </Button>
          )
        ) : null}
        {stage === "ready" || stage === "failed" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={`gallery-detail-${session.id}`}
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />} Details
          </Button>
        ) : null}
        {ctx.billing.isAdmin ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDelete}
            aria-label={`Delete the gallery for ${name}`}
            className="text-muted-foreground hover:text-danger"
            data-testid={`delete-gallery-${session.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {open && (stage === "ready" || stage === "failed") ? <GalleryDetail session={session} /> : null}
    </li>
  );
}

/** Failure detail and the quality flag come from the owner session endpoint, fetched on open. */
function GalleryDetail({ session }: { session: SessionSummary }) {
  const detail = useGetSession(session.id, {
    query: { queryKey: getGetSessionQueryKey(session.id), staleTime: 60_000, retry: 1 },
  });
  const data = detail.data;
  const quality = qualityNote(data?.qualitySummary);
  const failed = session.status === "failed";

  return (
    <div className="gallery-detail" id={`gallery-detail-${session.id}`} role="region" aria-label={`Details for gallery ${session.id}`}>
      {detail.isLoading ? (
        <p role="status">Loading details…</p>
      ) : detail.isError ? (
        <p>Details could not load. {apiErrorMessage(detail.error, "")}</p>
      ) : (
        <>
          {failed ? (
            <p>
              <strong className="text-foreground">Why it failed: </strong>
              {data?.failureDetail || data?.errorMessage || "The renderer gave up after its retries."} The credit was
              refunded; start it again with clearer photos of both faces.
            </p>
          ) : null}
          {quality ? (
            <p>
              <Tag tone="quality">Quality</Tag> {quality}
            </p>
          ) : !failed ? (
            <p>All frames passed our quality check.</p>
          ) : null}
          <p>
            {data?.viewCount ? `Opened ${data.viewCount} ${data.viewCount === 1 ? "time" : "times"}` : "Not opened yet"}
            {data?.firstViewedAt ? `, first on ${shortDate(data.firstViewedAt)}` : ""}.{" "}
            {data?.consentAt ? `Consent recorded ${shortDate(data.consentAt)}.` : ""}
          </p>
          <p>
            Reference <code>#{session.id}</code>
          </p>
        </>
      )}
    </div>
  );
}

function DeleteDialog({
  ctx,
  target,
  onClose,
}: {
  ctx: DashboardContext;
  target: SessionSummary | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const remove = useDeleteSession();
  const name = target?.coupleName?.trim() || "this gallery";

  const confirm = async () => {
    if (!target) return;
    try {
      await remove.mutateAsync({ id: target.id });
      toast({ title: "Gallery deleted" });
      onClose();
      void ctx.refreshDashboard();
    } catch (err) {
      toast({ title: "Delete failed", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <DialogContent>
        <DialogTitle>Delete {name}?</DialogTitle>
        <DialogDescription>
          This removes the gallery, the couple's photos and the private link. The couple can no longer open it.
        </DialogDescription>
        {target?.bookedAt ? (
          <Note tone="warn">This couple is marked as booked; the booking leaves your booked count too.</Note>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
            Keep gallery
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={remove.isPending} data-testid="delete-gallery-confirm">
            {remove.isPending ? "Deleting…" : "Delete gallery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
