import { useRef } from "react";
import { Camera, ImagePlus, X } from "lucide-react";
import { getListGalleryStylesQueryKey, useListGalleryStyles } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { MAX_COUPLE_PHOTOS, MIN_COUPLE_PHOTOS } from "./capture";
import { upcomingMonths } from "./galleryStats";
import { ACCEPTED_IMAGE_TYPES } from "./photoQueue";
import type { CoupleCapture } from "./useCoupleCapture";

/**
 * The form pieces Create a gallery and tour-day mode share: couple photo
 * slots (camera or library), the gallery style, the wedding month and the
 * consent the owner confirms on the couple's behalf.
 */

const ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

export function CouplePhotoSlots({
  capture,
  withCamera = false,
  idPrefix,
}: {
  capture: CoupleCapture;
  /** Tour-day mode on a phone: offer the camera first. */
  withCamera?: boolean;
  idPrefix: string;
}) {
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const full = capture.photos.length >= MAX_COUPLE_PHOTOS;

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) capture.addFiles(files);
  };

  return (
    <div className="grid gap-3">
      <input
        ref={libraryRef}
        id={`${idPrefix}-library`}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={onPick}
        data-testid={`${idPrefix}-photo-input`}
      />
      {withCamera ? (
        <input
          ref={cameraRef}
          id={`${idPrefix}-camera`}
          type="file"
          accept={ACCEPT}
          capture="environment"
          className="hidden"
          onChange={onPick}
        />
      ) : null}

      <div className="photo-slots">
        {Array.from({ length: MAX_COUPLE_PHOTOS }, (_, slot) => {
          const photo = capture.photos[slot];
          if (photo) {
            return (
              <div key={photo.id} className="photo-slot" data-filled="true">
                <img src={photo.preview} alt={`Couple photo ${slot + 1}`} />
                <button
                  type="button"
                  className="photo-slot-remove"
                  onClick={() => capture.removePhoto(photo.id)}
                  disabled={capture.busy}
                  aria-label={`Remove couple photo ${slot + 1}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          }
          return (
            <button
              key={`empty-${slot}`}
              type="button"
              className="photo-slot"
              onClick={() => (withCamera ? cameraRef.current : libraryRef.current)?.click()}
              disabled={capture.busy}
              aria-label={`Add couple photo ${slot + 1}${slot >= MIN_COUPLE_PHOTOS ? " (optional)" : ""}`}
            >
              {slot >= MIN_COUPLE_PHOTOS ? "Optional" : `Photo ${slot + 1}`}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        {withCamera ? (
          <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()} disabled={full || capture.busy}>
            <Camera className="h-4 w-4" /> Take a photo
          </Button>
        ) : null}
        <Button
          type="button"
          variant={withCamera ? "ghost" : "outline"}
          onClick={() => libraryRef.current?.click()}
          disabled={full || capture.busy}
        >
          <ImagePlus className="h-4 w-4" /> {withCamera ? "Choose from photos" : "Select photos"}
        </Button>
      </div>
      <p className="field-hint">
        Two or three clear photos with both faces in good light. Phone photos are fine.
      </p>
      {capture.notice ? (
        <p className="field-hint" data-tone="danger" role="status">
          {capture.notice}
        </p>
      ) : null}
    </div>
  );
}

export function StylePicker({ capture, idPrefix }: { capture: CoupleCapture; idPrefix: string }) {
  const styles = useListGalleryStyles({
    query: { queryKey: getListGalleryStylesQueryKey(), staleTime: 10 * 60_000, retry: 1 },
  });
  const list = styles.data?.styles ?? [];
  if (list.length <= 1) return null;
  const selected = capture.styleId ?? list[0]?.id ?? null;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-semibold">Gallery style</legend>
      <div className="style-options" role="radiogroup">
        {list.map((style) => {
          const checked = selected === style.id;
          return (
            <label key={style.id} className="style-option relative" data-checked={checked ? "true" : "false"}>
              <input
                type="radio"
                name={`${idPrefix}-style`}
                value={style.id}
                checked={checked}
                onChange={() => capture.setStyleId(style.id)}
                disabled={capture.busy}
              />
              <strong>{style.name}</strong>
              <small>{style.description}</small>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function WeddingMonthSelect({ capture, id }: { capture: CoupleCapture; id: string }) {
  const months = upcomingMonths(30);
  return (
    <div className="field">
      <label htmlFor={id}>
        Wedding month <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
      </label>
      <select
        id={id}
        className="dash-select"
        style={{ maxWidth: "none" }}
        value={capture.weddingMonth}
        onChange={(e) => capture.setWeddingMonth(e.target.value)}
        disabled={capture.busy}
        aria-describedby={`${id}-hint`}
      >
        <option value="">Not decided yet</option>
        {months.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <p id={`${id}-hint`} className="field-hint">
        Their gallery's “Check your date” button opens your booking link with this month.
      </p>
    </div>
  );
}

export function ConsentCheck({
  capture,
  venueName,
  retentionDays,
  id,
}: {
  capture: CoupleCapture;
  venueName: string;
  retentionDays: number;
  id: string;
}) {
  return (
    <label className="consent-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={capture.consent}
        onChange={(e) => capture.setConsent(e.target.checked)}
        disabled={capture.busy}
        data-testid={`${id}-input`}
      />
      <span>
        Both of them agreed to an AI preview of their wedding at {venueName}, made from these photos. Their photos are
        deleted {retentionDays} days after the gallery is delivered.
      </span>
    </label>
  );
}
