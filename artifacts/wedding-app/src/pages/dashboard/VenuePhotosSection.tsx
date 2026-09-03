import { useRef } from "react";
import type { VenueMediaCoverage, VenueMediaItem } from "@workspace/api-client-react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FrameTicks } from "@/components/motion";
import { cn } from "@/lib/utils";
import { COVERAGE_OPTIONS, venueReferenceUrl } from "./types";

type Props = {
  media: VenueMediaItem[];
  venueSlug: string;
  isUploading: boolean;
  uploadProgress: number;
  onUpload: (file: File, coverage: VenueMediaCoverage) => void;
  onDelete: (mediaId: number) => void;
  deletingId: number | null;
};

/**
 * Coverage checklist and photo library are the same thing: a grid of the
 * five views glimpse renders from. Missing views appear as dashed upload
 * targets pre-tagged with that coverage, so "what's missing" and "add it"
 * are one gesture.
 */
export function VenuePhotosSection({
  media,
  venueSlug,
  isUploading,
  uploadProgress,
  onUpload,
  onDelete,
  deletingId,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCoverage = useRef<VenueMediaCoverage>("detail");
  const present = new Set(media.map((m) => m.coverage));
  const missing = COVERAGE_OPTIONS.filter((c) => !present.has(c.value));
  const labelFor = (c: VenueMediaCoverage) => COVERAGE_OPTIONS.find((o) => o.value === c)?.label ?? c;

  const pick = (coverage: VenueMediaCoverage) => {
    pendingCoverage.current = coverage;
    inputRef.current?.click();
  };

  return (
    <section aria-labelledby="venue-photos-title" className="border-t border-border pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <p className="mono-label mb-3 text-rose">Venue photos</p>
          <h2 id="venue-photos-title" className="font-display text-2xl font-medium tracking-tight md:text-3xl">
            {media.length === 0
              ? "Add your first photo to open the link"
              : missing.length === 0
                ? "All five views covered"
                : `${5 - missing.length} of 5 views covered`}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Portraits are rendered in these rooms. One photo opens your link; five views place every
            portrait in the right space.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => pick(missing[0]?.value ?? "detail")}
          disabled={isUploading}
          className="h-10 px-4"
          data-testid="venue-add-photo"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {isUploading ? `Uploading ${uploadProgress}%` : "Add photo"}
        </Button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onUpload(file, pendingCoverage.current);
        }}
      />

      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Venue photos">
        {media.map((item) => (
          <li key={item.id} className="group relative aspect-[4/5] overflow-hidden border border-border bg-secondary">
            <img
              src={venueReferenceUrl(item.objectKey, venueSlug)}
              alt={`${labelFor(item.coverage)} view of the venue`}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              className="h-full w-full object-cover"
            />
            <FrameTicks size={14} className="text-white/70" />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
            <span className="mono-label absolute bottom-2.5 left-3 text-white">{labelFor(item.coverage)}</span>
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              disabled={deletingId === item.id}
              aria-label={`Remove ${labelFor(item.coverage)} photo`}
              className={cn(
                "absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-md bg-black/60 text-white backdrop-blur-sm transition-opacity",
                "opacity-0 hover:bg-red-500 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 [@media(hover:none)]:opacity-100",
              )}
            >
              {deletingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          </li>
        ))}
        {missing.map((c) => (
          <li key={c.value}>
            <button
              type="button"
              onClick={() => pick(c.value)}
              disabled={isUploading}
              className={cn(
                "flex aspect-[4/5] w-full flex-col items-center justify-center gap-2 border border-dashed border-border bg-background/40 px-3 text-center transition-colors",
                "hover:border-rose hover:text-rose focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                media.length === 0 && c.value === "exterior" ? "text-rose border-rose/60" : "text-muted-foreground",
              )}
              data-testid={`venue-add-${c.value}`}
            >
              <Plus className="h-5 w-5" />
              <span className="mono-label">{c.label}</span>
              <span className="text-xs">{c.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
