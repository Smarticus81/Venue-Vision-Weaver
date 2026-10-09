import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, ImagePlus, Loader2, RefreshCw, Trash2, Upload, X } from "lucide-react";
import {
  useAddVenueMedia,
  useDeleteVenueMedia,
  useImportVenueWebsiteMedia,
  type VenueMediaItem,
} from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { normalizeWebsiteInput } from "@/lib/venueSlug";
import { isCoverage, type Coverage } from "./activation";
import { apiErrorMessage, describeApiError, isFeatureUnavailable } from "./errors";
import { COVERAGE_TILES, coverageLabel, groupByCoverage, planUploads, ACCEPTED_IMAGE_TYPES } from "./photoQueue";
import { objectKeyFileName, venueReferenceUrl } from "./storageUrls";
import type { DashboardContext } from "./types";
import { Note, SectionHead, formatBytes } from "./ui";

interface QueueItem {
  id: string;
  file: File;
  coverage: Coverage;
  preview: string;
  status: "queued" | "uploading" | "saving" | "done" | "error";
  error?: string;
}

let queueSeq = 0;

/**
 * Venue photos as five labelled coverage tiles. Multi-file drops are planned
 * across the missing views, each file gets its own coverage picker before
 * upload, photos can be retagged or replaced, deletes ask first, and the
 * owner can pull candidate photos from their own website.
 */
export function VenuePhotos({ ctx, importRequested }: { ctx: DashboardContext; importRequested: boolean }) {
  const { toast } = useToast();
  const { slug, media, venue, readiness } = ctx;
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [forceCoverage, setForceCoverage] = useState<Coverage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VenueMediaItem | null>(null);
  const [busyMediaId, setBusyMediaId] = useState<number | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<VenueMediaItem | null>(null);
  const [websiteInput, setWebsiteInput] = useState("");
  const [importNote, setImportNote] = useState<string | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  queueRef.current = queue;

  const addMedia = useAddVenueMedia();
  const deleteMedia = useDeleteVenueMedia();
  const importMedia = useImportVenueWebsiteMedia();
  const { uploadFile, progress } = useUpload({ purpose: "venue", venueSlug: slug });

  const groups = useMemo(() => groupByCoverage(media), [media]);
  const queuedCoverages = queue.filter((q) => q.status !== "done").map((q) => q.coverage);

  useEffect(() => {
    return () => {
      queueRef.current.forEach((item) => URL.revokeObjectURL(item.preview));
    };
  }, []);

  const addFiles = (files: File[], coverage: Coverage | null) => {
    const plan = planUploads(files, media, { forceCoverage: coverage, existingQueued: queuedCoverages });
    if (plan.rejected.some((r) => r.reason === "type")) {
      toast({ title: "Use JPG, PNG or WebP photos", variant: "destructive" });
    }
    if (plan.rejected.some((r) => r.reason === "limit")) {
      toast({ title: "That is enough for one batch", description: "Upload these first, then add more." });
    }
    if (plan.accepted.length === 0) return;
    setQueue((prev) => [
      ...prev.filter((q) => q.status !== "done"),
      ...plan.accepted.map(({ file, coverage: c }) => ({
        id: `q${++queueSeq}`,
        file,
        coverage: c,
        preview: URL.createObjectURL(file),
        status: "queued" as const,
      })),
    ]);
  };

  const openPicker = (coverage: Coverage | null) => {
    setForceCoverage(coverage);
    inputRef.current?.click();
  };

  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    addFiles(files, forceCoverage);
    setForceCoverage(null);
  };

  const removeQueued = (id: string) => {
    setQueue((prev) => {
      const item = prev.find((q) => q.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((q) => q.id !== id);
    });
  };

  const patchQueue = (id: string, patch: Partial<QueueItem>) =>
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  const registerPhoto = async (objectKey: string, coverage: Coverage, displayOrder: number) => {
    await addMedia.mutateAsync({ slug, data: { objectKey, coverage, displayOrder } });
  };

  const startUpload = async () => {
    const pending = queueRef.current.filter((q) => q.status === "queued" || q.status === "error");
    if (pending.length === 0) return;
    setUploading(true);
    let saved = 0;
    let order = media.length;
    for (const item of pending) {
      patchQueue(item.id, { status: "uploading", error: undefined });
      try {
        const uploaded = await uploadFile(item.file);
        if (!uploaded) throw new Error("Upload failed. Check the connection and try again.");
        patchQueue(item.id, { status: "saving" });
        await registerPhoto(uploaded.objectPath, item.coverage, order++);
        patchQueue(item.id, { status: "done" });
        saved += 1;
      } catch (err) {
        patchQueue(item.id, { status: "error", error: apiErrorMessage(err, "This photo was not saved.") });
      }
    }
    setUploading(false);
    if (saved > 0) {
      await ctx.refreshMedia();
      toast({ title: saved === 1 ? "Venue photo added" : `${saved} venue photos added` });
      window.setTimeout(() => {
        setQueue((prev) => {
          prev.filter((q) => q.status === "done").forEach((q) => URL.revokeObjectURL(q.preview));
          return prev.filter((q) => q.status !== "done");
        });
      }, 1200);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteMedia.mutateAsync({ slug, mediaId: target.id });
      setDeleteTarget(null);
      await ctx.refreshMedia();
      toast({ title: "Photo removed" });
    } catch (err) {
      toast({ title: "Could not remove the photo", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    }
  };

  /**
   * There is no endpoint to change a photo's coverage in place, so retagging
   * re-uploads the same image under the new role and removes the old row.
   */
  const retag = async (item: VenueMediaItem, next: Coverage) => {
    if (next === item.coverage) return;
    setBusyMediaId(item.id);
    try {
      const response = await fetch(venueReferenceUrl(item.objectKey, slug), { credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not read the photo to retag it.");
      const blob = await response.blob();
      const type = (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(blob.type) ? blob.type : "image/jpeg";
      const file = new File([blob], objectKeyFileName(item.objectKey), { type });
      const uploaded = await uploadFile(file);
      if (!uploaded) throw new Error("Upload failed while retagging.");
      await deleteMedia.mutateAsync({ slug, mediaId: item.id });
      try {
        await registerPhoto(uploaded.objectPath, next, item.displayOrder);
      } catch (err) {
        toast({
          title: "The photo was removed but not re-added",
          description: `${apiErrorMessage(err, "Upload it again.")} Upload it again under ${coverageLabel(next)}.`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: `Moved to ${coverageLabel(next)}` });
    } catch (err) {
      toast({ title: "Could not retag the photo", description: apiErrorMessage(err, "Try again."), variant: "destructive" });
    } finally {
      setBusyMediaId(null);
      await ctx.refreshMedia();
    }
  };

  const onReplacePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!file || !target) return;
    setBusyMediaId(target.id);
    try {
      const uploaded = await uploadFile(file);
      if (!uploaded) throw new Error("Upload failed.");
      await registerPhoto(uploaded.objectPath, target.coverage, target.displayOrder);
      await deleteMedia.mutateAsync({ slug, mediaId: target.id });
      toast({ title: `${coverageLabel(target.coverage)} photo replaced` });
    } catch (err) {
      toast({ title: "Could not replace the photo", description: apiErrorMessage(err, "The old photo is still in place."), variant: "destructive" });
    } finally {
      setBusyMediaId(null);
      await ctx.refreshMedia();
    }
  };

  const runImport = async (overrideUrl?: string) => {
    setImportNote(null);
    try {
      const result = await importMedia.mutateAsync({ slug, data: overrideUrl ? { websiteUrl: overrideUrl } : {} });
      await Promise.all([ctx.refreshMedia(), ctx.refreshDashboard()]);
      if (result.imported.length === 0) {
        setImportNote(
          result.candidatesFound > 0
            ? "We found photos on the site but none were usable as venue references. Add them by hand."
            : "We could not find usable space photos on the site. Add them by hand.",
        );
      } else {
        setImportNote(
          `${result.imported.length} ${result.imported.length === 1 ? "photo" : "photos"} imported from your website. Check each tile and move or remove anything that is off.`,
        );
      }
      if (result.warnings.length > 0) setImportNote((n) => `${n ?? ""} ${result.warnings[0]}`.trim());
    } catch (err) {
      const failure = describeApiError(err);
      if (isFeatureUnavailable(err)) setImportNote("Website import is not switched on for this server yet. Add photos by hand for now.");
      else if (failure.status === 429) setImportNote("The import already ran recently. Try again in a little while.");
      else setImportNote(apiErrorMessage(err, "The import did not run."));
    }
  };

  const importOnce = useRef(false);
  useEffect(() => {
    if (!importRequested || importOnce.current) return;
    if (!venue.websiteUrl || venue.websiteImportedAt) return;
    importOnce.current = true;
    void runImport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importRequested, venue.websiteUrl, venue.websiteImportedAt]);

  const activeQueue = queue.filter((q) => q.status !== "done");
  const uploadable = activeQueue.filter((q) => q.status === "queued" || q.status === "error").length;
  const websiteNormalized = normalizeWebsiteInput(websiteInput);

  return (
    <section className="dash-section" aria-labelledby="venue-photos-title">
      <SectionHead
        id="venue-photos-title"
        title="Venue photos"
        description={
          readiness.ready
            ? "All five views covered. Galleries are built from these, so swap in better photos any time."
            : `Add one photo for each view. ${readiness.needed} more and couples can start.`
        }
        aside={
          <>
            <Button type="button" variant="outline" onClick={() => openPicker(null)} disabled={uploading} data-testid="venue-photos-add">
              <ImagePlus className="h-4 w-4" /> Add photos
            </Button>
            {venue.websiteUrl ? (
              <Button type="button" variant="ghost" onClick={() => void runImport()} disabled={importMedia.isPending} data-testid="venue-photos-import">
                {importMedia.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                Import from website
              </Button>
            ) : null}
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={onPicked}
        data-testid="venue-photo-input"
      />
      <input ref={replaceInputRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} className="hidden" onChange={onReplacePicked} />

      {importNote ? (
        <Note tone={importMedia.isError ? "warn" : "info"} role="status">
          {importNote}
        </Note>
      ) : importMedia.isPending ? (
        <Note role="status">Reading {venue.websiteUrl?.replace(/^https?:\/\//, "")} for photos of your spaces…</Note>
      ) : null}

      {!venue.websiteUrl && media.length < 5 ? (
        <form
          className="dash-card dash-card-tight flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (websiteNormalized) void runImport(websiteNormalized);
          }}
        >
          <div className="field flex-1">
            <label htmlFor="import-website">Pull photos from your website</label>
            <Input
              id="import-website"
              type="url"
              inputMode="url"
              placeholder="yourvenue.com"
              value={websiteInput}
              onChange={(e) => setWebsiteInput(e.target.value)}
              aria-describedby="import-website-hint"
            />
            <p id="import-website-hint" className="field-hint">
              We save the address on your venue and pull the space photos it shows. You confirm every one.
            </p>
          </div>
          <Button type="submit" variant="outline" disabled={!websiteNormalized || importMedia.isPending} data-testid="venue-photos-import">
            {importMedia.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            Import
          </Button>
        </form>
      ) : null}

      {activeQueue.length > 0 ? (
        <div className="dash-card dash-section" aria-live="polite">
          <div className="dash-section-head">
            <div>
              <h2 className="text-lg">Ready to upload</h2>
              <p>Check the view for each photo. Change it with the picker before you upload.</p>
            </div>
            <Button type="button" variant="brand" onClick={() => void startUpload()} disabled={uploading || uploadable === 0} data-testid="venue-photos-upload">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? `Uploading ${progress}%` : `Upload ${uploadable} ${uploadable === 1 ? "photo" : "photos"}`}
            </Button>
          </div>
          <ul className="upload-queue">
            {activeQueue.map((item) => (
              <li key={item.id} className="upload-queue-item">
                <img src={item.preview} alt="" />
                <div className="min-w-0">
                  <p className="upload-queue-name">{item.file.name}</p>
                  <p className="upload-queue-size">
                    {formatBytes(item.file.size)}
                    {item.status === "uploading" ? " · uploading" : item.status === "saving" ? " · saving" : item.status === "error" ? ` · ${item.error}` : ""}
                  </p>
                  {item.status === "uploading" ? (
                    <div className="upload-progress mt-1" aria-hidden="true">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                  ) : null}
                </div>
                <label className="sr-only" htmlFor={`cov-${item.id}`}>
                  View for {item.file.name}
                </label>
                <select
                  id={`cov-${item.id}`}
                  className="dash-select"
                  value={item.coverage}
                  disabled={item.status === "uploading" || item.status === "saving"}
                  onChange={(e) => {
                    if (isCoverage(e.target.value)) patchQueue(item.id, { coverage: e.target.value });
                  }}
                >
                  {COVERAGE_TILES.map((tile) => (
                    <option key={tile.coverage} value={tile.coverage}>
                      {tile.label}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item.file.name} from the upload`} onClick={() => removeQueued(item.id)} disabled={item.status === "uploading" || item.status === "saving"}>
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="coverage-grid">
        {COVERAGE_TILES.map((tile) => {
          const items = groups.get(tile.coverage) ?? [];
          const filled = items.length > 0;
          const queuedHere = activeQueue.filter((q) => q.coverage === tile.coverage).length;
          return (
            <article
              key={tile.coverage}
              className="coverage-tile"
              data-filled={filled ? "true" : "false"}
              data-target={!filled && readiness.missing[0] === tile.coverage ? "true" : "false"}
              data-testid={`coverage-tile-${tile.coverage}`}
              aria-label={`${tile.label}: ${filled ? `${items.length} ${items.length === 1 ? "photo" : "photos"}` : "no photo yet"}`}
            >
              <div className="coverage-tile-head">
                <strong>{tile.label}</strong>
                <span className={filled ? "eyebrow text-success" : "eyebrow text-muted-foreground"}>
                  {filled ? `${items.length} ${items.length === 1 ? "photo" : "photos"}` : queuedHere > 0 ? `${queuedHere} queued` : "Missing"}
                </span>
              </div>
              <div className="coverage-tile-media">
                {filled ? (
                  items.map((item) => (
                    <div key={item.id} className="coverage-thumb">
                      <img
                        src={venueReferenceUrl(item.objectKey, slug)}
                        alt={`${tile.label} reference photo`}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.visibility = "hidden";
                        }}
                      />
                      {busyMediaId === item.id ? (
                        <div className="absolute inset-0 grid place-items-center bg-ink/60 text-ink-foreground" role="status">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          <span className="sr-only">Working on this photo</span>
                        </div>
                      ) : (
                        <div className="coverage-thumb-actions">
                          <label className="sr-only" htmlFor={`retag-${item.id}`}>
                            Change view for this photo
                          </label>
                          <select
                            id={`retag-${item.id}`}
                            value={item.coverage}
                            onChange={(e) => {
                              if (isCoverage(e.target.value)) void retag(item, e.target.value);
                            }}
                            data-testid={`venue-media-retag-${item.id}`}
                          >
                            {COVERAGE_TILES.map((opt) => (
                              <option key={opt.coverage} value={opt.coverage}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              aria-label={`Replace this ${tile.label.toLowerCase()} photo`}
                              onClick={() => {
                                setReplaceTarget(item);
                                replaceInputRef.current?.click();
                              }}
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </button>
                            <button type="button" aria-label={`Delete this ${tile.label.toLowerCase()} photo`} onClick={() => setDeleteTarget(item)} data-testid={`venue-media-delete-${item.id}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="coverage-tile-empty">
                    <span>{tile.hint}</span>
                  </div>
                )}
                <p className="coverage-tile-hint">Used for: {tile.scene.toLowerCase()}.</p>
              </div>
              <button type="button" className="coverage-tile-add" onClick={() => openPicker(tile.coverage)} disabled={uploading}>
                <ImagePlus className="h-4 w-4" /> {filled ? "Add another" : `Add ${tile.label.toLowerCase()} photo`}
              </button>
            </article>
          );
        })}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !deleteMedia.isPending && setDeleteTarget(null)}>
        <DialogContent>
          <DialogTitle>Remove this {deleteTarget ? coverageLabel(deleteTarget.coverage).toLowerCase() : ""} photo?</DialogTitle>
          <DialogDescription>
            {deleteTarget && (groups.get(deleteTarget.coverage)?.length ?? 0) <= 1
              ? "It is the only photo for this view, so couples will not be able to start a gallery until you add another."
              : "Galleries already made keep their images. New ones will stop using this photo."}
          </DialogDescription>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteMedia.isPending}>
              Keep photo
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteMedia.isPending} data-testid="venue-media-delete-confirm">
              {deleteMedia.isPending ? "Removing…" : "Remove photo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
