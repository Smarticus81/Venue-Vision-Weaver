import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  getGetVenueQueryKey,
  useCreateSession,
  useGetVenue,
  useListGalleryStyles,
  type ErrorEnvelope,
  type ErrorType,
  type GalleryStyleSummary,
  type VenuePublicResponse,
} from "@workspace/api-client-react";
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { CoupleChrome } from "@/components/layout/CoupleChrome";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { usePublicConfig } from "@/lib/publicConfig";
import {
  EMPTY_COUPLE_DRAFT,
  clearCoupleDraft,
  loadCoupleDraft,
  resumableStep,
  saveCoupleDraft,
  type CoupleDraft,
} from "@/lib/recovery";
import {
  formatWeddingMonth,
  rememberCreatedGallery,
  sessionStore,
  venueMediaUrl,
  weddingMonthOptions,
} from "@/lib/shareSession";
import { initialStyleId, orderStyles, styleSample } from "@/lib/styleSamples";

/* ————— Photo rules (mirror lib/referenceImage.ts and routes/storage.ts) ————— */

const MAX_COUPLE_PHOTOS = 3;
const MIN_COUPLE_PHOTOS = 2;
const MIN_COUPLE_PHOTO_EDGE = 256;
const MAX_COUPLE_PHOTO_BYTES = 50 * 1024 * 1024;
/** Long edge after client downscale: plenty for likeness, fast on a phone connection. */
const MAX_UPLOAD_EDGE = 2048;
const UPLOAD_JPEG_QUALITY = 0.88;
/** The couple upload token lives 20 minutes; refresh it a little before that. */
const UPLOAD_TOKEN_REFRESH_MS = 15 * 60 * 1000;
const COUPLE_REFERENCE_ROLES = ["Together", "Partner A", "Partner B"] as const;
const COUPLE_REFERENCE_GUIDANCE = [
  "Both faces visible",
  "Face forward, close up",
  "Face forward, close up",
] as const;
const ACCEPTED_PHOTO_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STEP_LABELS = ["Your venue", "Your photos", "Your look"] as const;

type SlotIndex = 0 | 1 | 2;

interface SlotPhoto {
  id: string;
  blob: Blob;
  name: string;
  previewUrl: string;
  /** Object key once uploaded; cleared when the server says it is stale. */
  uploadedKey: string | null;
  /** 0-100 while uploading, null otherwise. */
  progress: number | null;
  error: string | null;
}

type Slots = [SlotPhoto | null, SlotPhoto | null, SlotPhoto | null];
const EMPTY_SLOTS: Slots = [null, null, null];

/* ————— Photo preparation ————— */

class PhotoProblem extends Error {}

function isHeicFile(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

function isAcceptedFile(file: File): boolean {
  return /^image\/(jpeg|png|webp)$/i.test(file.type) || isHeicFile(file);
}

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decodeImage(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      /* fall through to <img>, which is how Safari opens HEIC */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}

function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Turns whatever the phone gives us (JPG, PNG, WebP, or HEIC where the
 * browser can open it) into an upright JPEG no longer than 2048px. Re-encoding
 * also drops EXIF, so location data never leaves the phone.
 */
async function prepareCouplePhoto(file: File): Promise<{ blob: Blob; name: string }> {
  if (!isAcceptedFile(file)) {
    throw new PhotoProblem("Choose a JPG, PNG, WebP or HEIC photo.");
  }
  if (file.size > MAX_COUPLE_PHOTO_BYTES) {
    throw new PhotoProblem("That photo is over 50MB. Choose a smaller copy.");
  }
  let image: Decoded;
  try {
    image = await decodeImage(file);
  } catch {
    throw new PhotoProblem(
      isHeicFile(file)
        ? "This browser can't open HEIC photos. Choose a JPG, or pick the photo from your phone's photo library."
        : "We couldn't open that photo. Try another one.",
    );
  }
  try {
    if (image.width < MIN_COUPLE_PHOTO_EDGE || image.height < MIN_COUPLE_PHOTO_EDGE) {
      throw new PhotoProblem("That photo is too small. Use one at least 256px wide and tall.");
    }
    const size = fitWithin(image.width, image.height, MAX_UPLOAD_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new PhotoProblem("We couldn't prepare that photo. Try another one.");
    ctx.drawImage(image.source, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", UPLOAD_JPEG_QUALITY),
    );
    if (!blob) throw new PhotoProblem("We couldn't prepare that photo. Try another one.");
    const base = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "photo";
    return { blob, name: `${base}.jpg` };
  } finally {
    image.release();
  }
}

/* ————— Upload with real progress ————— */

class UploadProblem extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function uploadCouplePhoto(
  photo: SlotPhoto,
  venueSlug: string,
  uploadToken: string | undefined,
  onProgress: (percent: number) => void,
): Promise<string> {
  onProgress(2);
  let res: Response;
  try {
    res = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: photo.name,
        size: photo.blob.size,
        contentType: "image/jpeg",
        purpose: "couple",
        venueSlug,
        uploadToken,
      }),
    });
  } catch {
    throw new UploadProblem("Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as { uploadURL?: string; objectPath?: string; error?: string };
  if (!res.ok || !data.uploadURL || !data.objectPath) {
    throw new UploadProblem(data.error ?? "We couldn't start the upload. Try again.", res.status);
  }
  const uploadURL = data.uploadURL;
  onProgress(5);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadURL);
    xhr.setRequestHeader("Content-Type", "image/jpeg");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(5 + Math.round((event.loaded / event.total) * 94));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadProblem("The photo didn't finish uploading. Try again.", xhr.status));
    xhr.onerror = () => reject(new UploadProblem("Check your connection and try again.", 0));
    xhr.send(photo.blob);
  });
  onProgress(100);
  return data.objectPath;
}

/* ————— Turnstile (only when the venue's server enforces it) ————— */

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScript: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!turnstileScript) {
    turnstileScript = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
      script.onerror = () => {
        turnstileScript = null;
        script.remove();
        reject(new Error("turnstile"));
      };
      document.head.appendChild(script);
    });
  }
  return turnstileScript;
}

function TurnstileCheck({
  siteKey,
  resetSignal,
  onToken,
}: {
  siteKey: string;
  resetSignal: number;
  onToken: (token: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !ref.current) return;
        widgetId.current = api.render(ref.current, {
          sitekey: siteKey,
          action: "create_session",
          theme: "auto",
          callback: (token: string) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetSignal > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onTokenRef.current(null);
    }
  }, [resetSignal]);

  return (
    <div className="cp-turnstile">
      <div ref={ref} />
      {failed ? (
        <p role="alert" className="cp-field-error">
          The quick security check didn't load. Check your connection, then refresh this page.
        </p>
      ) : null}
    </div>
  );
}

/* ————— Page ————— */

function errorCode(err: ErrorType<ErrorEnvelope>): string | undefined {
  return (err.data as { code?: string } | null | undefined)?.code;
}

function pushStep(step: number) {
  try {
    window.history.pushState({ ...(window.history.state ?? {}), coupleStep: step }, "");
  } catch {
    /* history unavailable */
  }
}

export default function CouplePage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const config = usePublicConfig();

  const venueQuery = useGetVenue(slug, {
    query: {
      enabled: !!slug,
      queryKey: getGetVenueQueryKey(slug),
      retry: (count, err) => (err as { status?: number }).status !== 404 && count < 2,
      refetchOnWindowFocus: false,
    },
  });
  const stylesQuery = useListGalleryStyles();
  const createSession = useCreateSession();

  const [step, setStep] = useState(1);
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS);
  const slotsRef = useRef<Slots>(EMPTY_SLOTS);
  slotsRef.current = slots;
  const [draft, setDraft] = useState<CoupleDraft>(EMPTY_COUPLE_DRAFT);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [consent, setConsent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<"uploading" | "starting">("uploading");
  const [formError, setFormError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  submittingRef.current = submitting;
  const mainRef = useRef<HTMLElement>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const filledCount = slots.filter(Boolean).length;
  const venue = venueQuery.data;

  /* Restore the in-tab draft once per venue. */
  useEffect(() => {
    if (!slug) return;
    const saved = loadCoupleDraft(sessionStore(), slug, Date.now());
    const initial = resumableStep(saved, 0, MIN_COUPLE_PHOTOS);
    if (saved) {
      setDraft({ ...saved, step: initial });
      setRestoredDraft(initial >= 2);
    }
    setStep(initial);
    setDraftLoaded(true);
    try {
      window.history.replaceState({ ...(window.history.state ?? {}), coupleStep: initial }, "");
    } catch {
      /* history unavailable */
    }
  }, [slug]);

  /* Persist the draft (never photos, never consent). */
  useEffect(() => {
    if (!draftLoaded || !slug || step > 3) return;
    saveCoupleDraft(sessionStore(), slug, { ...draft, step }, Date.now());
  }, [draft, step, slug, draftLoaded]);

  /* Preselect the default style once styles load. */
  const styles = useMemo(() => orderStyles(stylesQuery.data?.styles ?? []), [stylesQuery.data]);
  useEffect(() => {
    if (styles.length === 0 || !draftLoaded) return;
    setDraft((d) => {
      const id = initialStyleId(styles, d.styleId);
      return id === d.styleId ? d : { ...d, styleId: id };
    });
  }, [styles, draftLoaded]);

  /* One history entry per step so the back gesture moves between steps. */
  const goToStep = useCallback((next: number) => {
    setFormError(null);
    setStep(next);
    pushStep(next);
  }, []);

  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const wanted = (event.state as { coupleStep?: number } | null)?.coupleStep;
      if (typeof wanted !== "number") return;
      if (submittingRef.current) {
        pushStep(4);
        return;
      }
      const filled = slotsRef.current.filter(Boolean).length;
      setStep(wanted >= 3 && filled < MIN_COUPLE_PHOTOS ? 2 : Math.min(Math.max(wanted, 1), 3));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (step > 1) {
      mainRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    }
  }, [step]);

  /* Release preview URLs when the page goes away. */
  useEffect(
    () => () => {
      for (const photo of slotsRef.current) if (photo) URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const updateSlot = useCallback((index: number, patch: Partial<SlotPhoto> | null) => {
    setSlots((prev) => {
      const next = [...prev] as Slots;
      const current = next[index];
      if (patch === null) {
        if (current) URL.revokeObjectURL(current.previewUrl);
        next[index] = null;
      } else if (current) {
        next[index] = { ...current, ...patch };
      }
      return next;
    });
  }, []);

  const placePhotos = useCallback(
    async (files: File[], startAt: number | null) => {
      if (files.length === 0) return;
      const current = slotsRef.current;
      const targets: number[] = startAt !== null ? [startAt] : [];
      for (let i = 0; i < MAX_COUPLE_PHOTOS && targets.length < files.length; i++) {
        if (!current[i] && !targets.includes(i)) targets.push(i);
      }
      if (targets.length < files.length) {
        toast({
          title: "Three photos is the most",
          description: "We kept the photos that fit. Remove one to swap it.",
        });
      }
      await Promise.all(
        targets.map(async (slotIndex, i) => {
          const file = files[i]!;
          try {
            const prepared = await prepareCouplePhoto(file);
            const photo: SlotPhoto = {
              id: `${Date.now()}-${slotIndex}-${Math.random().toString(36).slice(2, 8)}`,
              blob: prepared.blob,
              name: prepared.name,
              previewUrl: URL.createObjectURL(prepared.blob),
              uploadedKey: null,
              progress: null,
              error: null,
            };
            setSlots((prev) => {
              const next = [...prev] as Slots;
              const replaced = next[slotIndex];
              if (replaced) URL.revokeObjectURL(replaced.previewUrl);
              next[slotIndex] = photo;
              return next;
            });
          } catch (err) {
            toast({
              title: `${COUPLE_REFERENCE_ROLES[slotIndex]}: photo not added`,
              description: err instanceof PhotoProblem ? err.message : "We couldn't open that photo. Try another one.",
              variant: "destructive",
            });
          }
        }),
      );
      setRestoredDraft(false);
    },
    [toast],
  );

  /** A usable upload token: refetch the venue when the one we hold is near expiry. */
  const freshUploadToken = useCallback(
    async (force = false): Promise<string | undefined> => {
      const age = Date.now() - venueQuery.dataUpdatedAt;
      if (!force && venueQuery.data?.uploadToken && age < UPLOAD_TOKEN_REFRESH_MS) {
        return venueQuery.data.uploadToken;
      }
      const result = await venueQuery.refetch();
      return result.data?.uploadToken;
    },
    [venueQuery],
  );

  const failBackTo = (target: number, message: string, title = "We couldn't start your gallery") => {
    setSubmitting(false);
    setStep(target);
    setFormError(message);
    toast({ title, description: message, variant: "destructive" });
  };

  const handleSubmit = async () => {
    if (submittingRef.current || !venue) return;
    const email = draft.coupleEmail.trim().toLowerCase();
    const filled = slotsRef.current.flatMap((photo, index) => (photo ? [{ photo, index }] : []));
    if (filled.length < MIN_COUPLE_PHOTOS) {
      goToStep(2);
      return;
    }
    if (!EMAIL_PATTERN.test(email)) {
      setFormError("Check your email address. We send your gallery link there.");
      return;
    }
    if (!consent) {
      setFormError("Please confirm you both agree before we make your gallery.");
      return;
    }
    if (venue.turnstileSiteKey && !turnstileToken) {
      setFormError("Please finish the quick security check.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    setPhase("uploading");
    setStep(4);

    /* 1. Upload every photo the server does not already hold. */
    let keys: string[];
    try {
      let token = await freshUploadToken();
      for (const { index } of filled) updateSlot(index, { error: null });
      keys = await Promise.all(
        filled.map(async ({ photo, index }) => {
          if (photo.uploadedKey) return photo.uploadedKey;
          const onProgress = (percent: number) => updateSlot(index, { progress: percent });
          let key: string;
          try {
            key = await uploadCouplePhoto(photo, venue.slug, token, onProgress);
          } catch (err) {
            if (!(err instanceof UploadProblem) || err.status !== 401) throw err;
            // The token expired mid-flow: fetch a fresh one and retry once.
            token = await freshUploadToken(true);
            key = await uploadCouplePhoto(photo, venue.slug, token, onProgress);
          }
          updateSlot(index, { uploadedKey: key, progress: 100 });
          return key;
        }),
      );
    } catch (err) {
      const message = err instanceof UploadProblem ? err.message : "Check your connection and try again.";
      setSlots(
        (prev) => prev.map((p) => (p && !p.uploadedKey ? { ...p, progress: null, error: message } : p)) as Slots,
      );
      failBackTo(3, `${message} Everything you entered is still here.`, "Your photos didn't upload");
      return;
    }

    /* 2. Start the gallery. */
    setPhase("starting");
    try {
      const session = await createSession.mutateAsync({
        slug: venue.slug,
        data: {
          couplePhotoKeys: keys,
          styleId: draft.styleId ?? undefined,
          coupleName: draft.coupleName.trim() || undefined,
          coupleEmail: email,
          weddingMonth: draft.weddingMonth || undefined,
          consent: true,
          createdVia: "couple_link",
          turnstileToken: turnstileToken ?? undefined,
        },
      });
      rememberCreatedGallery(sessionStore(), session.shareToken, { venueSlug: venue.slug, email });
      clearCoupleDraft(sessionStore(), venue.slug);
      setLocation(`/v/${session.shareToken}`, { replace: true });
    } catch (raw) {
      const err = raw as ErrorType<ErrorEnvelope>;
      const code = errorCode(err);
      const serverMessage = err.data?.error;
      if (venue.turnstileSiteKey) setTurnstileReset((n) => n + 1);
      if (err.status === 402 || code === "venue_not_ready") {
        failBackTo(
          3,
          "This venue is temporarily unavailable for new galleries. Please check with the venue team.",
          "This venue is paused",
        );
        return;
      }
      if (code === "stale_upload" || code === "invalid_photos" || code === "photo_count") {
        // The uploaded copies can't be reused: forget them so the next try re-uploads.
        setSlots((prev) => prev.map((p) => (p ? { ...p, uploadedKey: null, progress: null } : p)) as Slots);
        failBackTo(
          code === "stale_upload" ? 3 : 2,
          serverMessage ?? "Please add your photos again.",
          code === "stale_upload" ? "Your photos need to upload again" : "Check your photos",
        );
        return;
      }
      if (code === "consent_required") setConsent(false);
      failBackTo(3, serverMessage ?? "Something went wrong on our side. Your details are still here; try again.");
    }
  };

  /* ————— Render ————— */

  if (!slug || venueQuery.isLoading) return <CoupleSkeleton />;

  if (venueQuery.isError || !venue) {
    const notFound = (venueQuery.error as { status?: number } | null)?.status === 404;
    return (
      <CoupleChrome venue={null} eyebrow="Venue preview">
        <section className="cp-message">
          <p className="eyebrow">{notFound ? "Link not found" : "Connection"}</p>
          <h1>{notFound ? "We couldn't find this venue." : "We couldn't open this venue just now."}</h1>
          <p>
            {notFound
              ? "Check the link or QR code your venue gave you. If it still doesn't open, ask the venue team for a fresh link."
              : "Check your connection, then try again."}
          </p>
          {!notFound ? (
            <Button className="cp-message__action" onClick={() => void venueQuery.refetch()}>
              <RotateCcw /> Try again
            </Button>
          ) : null}
        </section>
      </CoupleChrome>
    );
  }

  if (!venue.isReady) {
    return (
      <CoupleChrome venue={venue}>
        <section className="cp-message">
          <p className="eyebrow">Almost ready</p>
          <h1>{venue.name} is still setting up.</h1>
          <p>The venue team is adding photos of their spaces. Previews open here as soon as they finish.</p>
          <Button variant="outline" className="cp-message__action" onClick={() => void venueQuery.refetch()}>
            <RotateCcw /> Check again
          </Button>
        </section>
      </CoupleChrome>
    );
  }

  return (
    <CoupleChrome
      venue={venue}
      mainRef={mainRef}
      mainClassName="cp-main"
      footerNote="Images are AI previews made from your photos and the venue's own photos."
    >
      {step <= 3 ? <StepProgress step={step} /> : null}
      <div className="cp-step" key={step}>
        {step === 1 && (
          <VenueWelcome venue={venue} retentionDays={config.retentionDays} onNext={() => goToStep(2)} />
        )}
        {step === 2 && (
          <PhotoStep
            slots={slots}
            restoredDraft={restoredDraft}
            onAdd={placePhotos}
            onRemove={(index) => updateSlot(index, null)}
            onBack={() => goToStep(1)}
            onNext={() => goToStep(3)}
          />
        )}
        {step === 3 && (
          <DetailsStep
            venue={venue}
            styles={styles}
            stylesLoading={stylesQuery.isLoading}
            stylesError={stylesQuery.isError}
            onRetryStyles={() => void stylesQuery.refetch()}
            draft={draft}
            onDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            consent={consent}
            onConsent={setConsent}
            filledCount={filledCount}
            turnstileReset={turnstileReset}
            onTurnstileToken={setTurnstileToken}
            turnstileReady={!venue.turnstileSiteKey || !!turnstileToken}
            formError={formError}
            onBack={() => goToStep(2)}
            onSubmit={() => void handleSubmit()}
            submitting={submitting}
          />
        )}
        {step === 4 && <UploadingStep slots={slots} phase={phase} venueName={venue.name} />}
      </div>
    </CoupleChrome>
  );
}

function StepProgress({ step }: { step: number }) {
  return (
    <ol className="cp-progress" aria-label="Steps">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span className="cp-progress__dot" aria-hidden>
              {state === "done" ? <Check size={12} /> : n}
            </span>
            <span className="cp-progress__label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/* ————— Step 1: the venue ————— */

function VenueWelcome({
  venue,
  retentionDays,
  onNext,
}: {
  venue: VenuePublicResponse;
  retentionDays: number;
  onNext: () => void;
}) {
  const photos = venue.media.slice(0, 6);
  const [active, setActive] = useState(0);
  const current = photos[active] ?? photos[0];
  return (
    <section className="cp-welcome">
      <figure className="cp-welcome__media">
        {current ? (
          <img
            src={venueMediaUrl(current.objectKey, venue.slug)}
            alt={`${venue.name}, photo ${active + 1} of ${photos.length}`}
            fetchPriority="high"
          />
        ) : null}
        {photos.length > 1 ? (
          <div className="cp-welcome__dots" role="group" aria-label="Venue photos">
            {photos.map((photo, i) => (
              <button
                key={photo.id}
                type="button"
                aria-label={`Show venue photo ${i + 1}`}
                aria-pressed={i === active}
                onClick={() => setActive(i)}
              />
            ))}
          </div>
        ) : null}
      </figure>
      <div className="cp-welcome__copy">
        <p className="eyebrow">A preview of your day</p>
        <h1>
          See the two of you at <span className="cp-nowrap">{venue.name}.</span>
        </h1>
        <p className="cp-lede">
          {venue.tagline?.trim() || "Add two or three photos of you, pick a look, and we'll imagine your day here."}
        </p>
        <ul className="cp-welcome__facts">
          <li>Four images and a short reel, set in this venue's real spaces</li>
          <li>Usually ready in about five minutes</li>
          <li>Free for you. {venue.name} covers it.</li>
        </ul>
        <Button variant="brand" size="lg" className="cp-primary" onClick={onNext} data-testid="visualize-cta">
          Start our preview <ArrowRight />
        </Button>
        <p className="cp-fineprint">
          These are AI previews, not photographs. Your photos are used only for this gallery and deleted{" "}
          {retentionDays} days after it's ready. <Link href="/privacy">How we handle photos</Link>
        </p>
      </div>
    </section>
  );
}

/* ————— Step 2: photos ————— */

function PhotoStep({
  slots,
  restoredDraft,
  onAdd,
  onRemove,
  onBack,
  onNext,
}: {
  slots: Slots;
  restoredDraft: boolean;
  onAdd: (files: File[], startAt: number | null) => Promise<void>;
  onRemove: (index: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const filled = slots.filter(Boolean).length;
  const ready = filled >= MIN_COUPLE_PHOTOS;
  const bulkRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handle = async (e: ChangeEvent<HTMLInputElement>, startAt: number | null) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setBusy(true);
    try {
      await onAdd(files, startAt);
    } finally {
      setBusy(false);
    }
  };

  const missing = MIN_COUPLE_PHOTOS - filled;
  const status = ready
    ? `${filled} of ${MAX_COUPLE_PHOTOS} added. Ready when you are.`
    : `${missing} more photo${missing === 1 ? "" : "s"} needed`;

  return (
    <section className="cp-panel" aria-labelledby="photos-heading">
      <header className="cp-panel__head">
        <p className="eyebrow">Your photos</p>
        <h1 id="photos-heading">Two or three photos of you</h1>
        <p className="cp-lede">
          Clear, well lit, faces forward. One of you together plus one of each of you works best. Pick distinct
          angles or expressions.
        </p>
        {restoredDraft ? (
          <p className="cp-note" role="status">
            Your details are saved. Photos aren't kept when a page reloads, so add them again here.
          </p>
        ) : null}
      </header>

      <div className="cp-slots">
        {COUPLE_REFERENCE_ROLES.map((role, i) => (
          <PhotoSlot
            key={role}
            index={i as SlotIndex}
            photo={slots[i] ?? null}
            disabled={busy}
            onPick={(e) => void handle(e, i)}
            onRemove={() => onRemove(i)}
          />
        ))}
      </div>

      <div className="cp-slots__footer">
        <p className="cp-status" data-testid="couple-photo-status" data-ready={ready} aria-live="polite">
          {busy ? "Preparing your photos…" : status}
        </p>
        {filled < MAX_COUPLE_PHOTOS ? (
          <button type="button" className="cp-textbutton" onClick={() => bulkRef.current?.click()} disabled={busy}>
            <ImagePlus size={16} /> Choose several at once
          </button>
        ) : null}
        <input
          ref={bulkRef}
          type="file"
          multiple
          hidden
          accept={ACCEPTED_PHOTO_TYPES}
          onChange={(e) => void handle(e, null)}
          data-testid="couple-photo-input"
        />
      </div>
      <p className="cp-fineprint">
        JPG, PNG, WebP or HEIC, up to 50MB each. We resize them on your device before they upload.
      </p>

      <div className="cp-actions">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
        <Button
          variant="brand"
          size="lg"
          className="cp-primary"
          onClick={onNext}
          disabled={!ready || busy}
          data-testid="choose-style-button"
        >
          Choose your look <ArrowRight />
        </Button>
      </div>
    </section>
  );
}

function PhotoSlot({
  index,
  photo,
  disabled,
  onPick,
  onRemove,
}: {
  index: SlotIndex;
  photo: SlotPhoto | null;
  disabled: boolean;
  onPick: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const role = COUPLE_REFERENCE_ROLES[index];
  const libraryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const labelId = `slot-${index}-label`;
  return (
    <div
      className="cp-slot"
      data-filled={!!photo}
      data-testid={`couple-slot-${index}`}
      role="group"
      aria-labelledby={labelId}
    >
      <div className="cp-slot__frame">
        {photo ? (
          <>
            <img src={photo.previewUrl} alt={`${role} photo`} />
            <button
              type="button"
              className="cp-slot__remove"
              onClick={onRemove}
              disabled={disabled}
              aria-label={`Remove the ${role} photo`}
              data-testid={`remove-couple-photo-${index}`}
            >
              <X size={16} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cp-slot__empty"
            onClick={() => libraryRef.current?.click()}
            disabled={disabled}
            aria-label={`Add the ${role} photo`}
          >
            <ImagePlus size={22} aria-hidden />
            <span>Add photo</span>
          </button>
        )}
      </div>
      <div className="cp-slot__meta">
        <p id={labelId} className="cp-slot__role">
          <span className="cp-slot__index">0{index + 1}</span> {role}
        </p>
        <p className="cp-slot__guide">{COUPLE_REFERENCE_GUIDANCE[index]}</p>
        {photo?.error ? <p className="cp-field-error">{photo.error}</p> : null}
        <div className="cp-slot__buttons">
          <button
            type="button"
            className="cp-textbutton"
            onClick={() => libraryRef.current?.click()}
            disabled={disabled}
          >
            <ImagePlus size={15} /> {photo ? "Replace" : "Choose"}
          </button>
          <button
            type="button"
            className="cp-textbutton cp-touch-only"
            onClick={() => cameraRef.current?.click()}
            disabled={disabled}
          >
            <Camera size={15} /> Take one
          </button>
        </div>
      </div>
      <input ref={libraryRef} type="file" hidden accept={ACCEPTED_PHOTO_TYPES} onChange={onPick} />
      <input ref={cameraRef} type="file" hidden accept="image/*" capture="user" onChange={onPick} />
    </div>
  );
}

/* ————— Step 3: look and details ————— */

function DetailsStep({
  venue,
  styles,
  stylesLoading,
  stylesError,
  onRetryStyles,
  draft,
  onDraft,
  consent,
  onConsent,
  filledCount,
  turnstileReset,
  onTurnstileToken,
  turnstileReady,
  formError,
  onBack,
  onSubmit,
  submitting,
}: {
  venue: VenuePublicResponse;
  styles: GalleryStyleSummary[];
  stylesLoading: boolean;
  stylesError: boolean;
  onRetryStyles: () => void;
  draft: CoupleDraft;
  onDraft: (patch: Partial<CoupleDraft>) => void;
  consent: boolean;
  onConsent: (value: boolean) => void;
  filledCount: number;
  turnstileReset: number;
  onTurnstileToken: (token: string | null) => void;
  turnstileReady: boolean;
  formError: string | null;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const months = useMemo(() => weddingMonthOptions(new Date()), []);
  const emailValid = EMAIL_PATTERN.test(draft.coupleEmail.trim());
  const canSubmit =
    !!draft.styleId && emailValid && consent && turnstileReady && filledCount >= MIN_COUPLE_PHOTOS && !submitting;
  const monthLabel = formatWeddingMonth(draft.weddingMonth);
  const blocker =
    filledCount < MIN_COUPLE_PHOTOS
      ? "Add at least two photos first."
      : !draft.styleId
        ? "Pick a look."
        : !emailValid
          ? "Add your email."
          : !consent
            ? "Tick the box to confirm you both agree."
            : "Finish the quick security check.";

  return (
    <section className="cp-panel" aria-labelledby="details-heading">
      <header className="cp-panel__head">
        <p className="eyebrow">Your look</p>
        <h1 id="details-heading">Pick a look, then where to send it</h1>
      </header>

      <fieldset className="cp-styles">
        <legend className="cp-label">Look</legend>
        {stylesLoading ? (
          <div className="cp-styles__grid">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="cp-style-skeleton" />
            ))}
          </div>
        ) : styles.length === 0 ? (
          <div role="status" className="cp-note">
            {stylesError ? "Looks couldn't load. Your photos are still here." : "No looks are available right now."}{" "}
            <button type="button" className="cp-textbutton" onClick={onRetryStyles}>
              Try again
            </button>
          </div>
        ) : (
          <div className="cp-styles__grid" role="radiogroup" aria-label="Look">
            {styles.map((style) => {
              const sample = styleSample(style.id);
              const selected = draft.styleId === style.id;
              return (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className="cp-style"
                  data-selected={selected}
                  onClick={() => onDraft({ styleId: style.id })}
                  disabled={submitting}
                  data-testid={`style-option-${style.id}`}
                >
                  {sample ? (
                    <img src={sample.src} width={sample.width} height={sample.height} alt="" loading="lazy" />
                  ) : (
                    <span className="cp-style__blank" aria-hidden />
                  )}
                  <span className="cp-style__body">
                    <span className="cp-style__name">
                      {style.name}
                      <span className="cp-style__check" aria-hidden>
                        <Check size={14} />
                      </span>
                    </span>
                    {sample ? <span className="cp-style__mood">{sample.mood}</span> : null}
                    <span className="cp-style__desc">{style.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <p className="cp-fineprint">
          Example looks on one sample image. Yours is made from your photos at {venue.name}.
        </p>
      </fieldset>

      <form
        className="cp-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        <div className="cp-field">
          <label htmlFor="couple-email" className="cp-label">
            Your email
          </label>
          <input
            id="couple-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={draft.coupleEmail}
            onChange={(e) => onDraft({ coupleEmail: e.target.value })}
            disabled={submitting}
            aria-invalid={draft.coupleEmail.trim() !== "" && !emailValid}
            aria-describedby="couple-email-help"
            data-testid="style-couple-email"
          />
          <p id="couple-email-help" className="cp-help">
            Your gallery link comes here so you can find it again. No newsletters.
          </p>
        </div>

        <div className="cp-field-row">
          <div className="cp-field">
            <label htmlFor="couple-name" className="cp-label">
              Your names <span className="cp-optional">optional</span>
            </label>
            <input
              id="couple-name"
              type="text"
              autoComplete="off"
              maxLength={80}
              placeholder="Ana & Sam"
              value={draft.coupleName}
              onChange={(e) => onDraft({ coupleName: e.target.value })}
              disabled={submitting}
              data-testid="style-couple-name"
            />
          </div>
          <div className="cp-field">
            <label htmlFor="wedding-month" className="cp-label">
              When are you thinking? <span className="cp-optional">optional</span>
            </label>
            <select
              id="wedding-month"
              value={draft.weddingMonth}
              onChange={(e) => onDraft({ weddingMonth: e.target.value })}
              disabled={submitting}
              aria-describedby="wedding-month-help"
              data-testid="wedding-month"
            >
              <option value="">Not sure yet</option>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <p id="wedding-month-help" className="cp-help">
              {monthLabel
                ? `When you check your date, ${venue.name} sees ${monthLabel}.`
                : `Shared with ${venue.name} when you check your date.`}
            </p>
          </div>
        </div>

        <label className="cp-consent" data-checked={consent}>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => onConsent(e.target.checked)}
            disabled={submitting}
            required
            data-testid="couple-consent"
          />
          <span>
            <strong>We both agree.</strong> We're both in these photos, and we're both happy for them to be used to
            make AI preview images of us at {venue.name}. They're used for this gallery only.{" "}
            <Link href="/privacy">Details</Link>
          </span>
        </label>

        {venue.turnstileSiteKey ? (
          <TurnstileCheck siteKey={venue.turnstileSiteKey} resetSignal={turnstileReset} onToken={onTurnstileToken} />
        ) : null}

        <div className="cp-summary">
          <p className="cp-summary__title">What happens next</p>
          <p>
            Your photos upload, then the next page shows your gallery as it's made: four AI images and a short reel,
            usually in about five minutes. Keep that page's link to come back any time.
          </p>
        </div>

        {formError ? (
          <p role="alert" className="cp-field-error">
            {formError}
          </p>
        ) : null}

        <div className="cp-actions">
          <Button type="button" variant="ghost" onClick={onBack} disabled={submitting} data-testid="style-back-button">
            <ArrowLeft /> Back
          </Button>
          <Button
            type="submit"
            variant="brand"
            size="lg"
            className="cp-primary"
            disabled={!canSubmit}
            data-testid="generate-button"
          >
            {submitting ? <Loader2 className="animate-spin" /> : null}
            Make our gallery
          </Button>
        </div>
        {!canSubmit && !submitting ? (
          <p className="cp-help cp-actions__why" aria-live="polite">
            {blocker}
          </p>
        ) : null}
      </form>
    </section>
  );
}

/* ————— Step 4: uploading ————— */

function UploadingStep({
  slots,
  phase,
  venueName,
}: {
  slots: Slots;
  phase: "uploading" | "starting";
  venueName: string;
}) {
  return (
    <section className="cp-panel cp-uploading" aria-labelledby="uploading-heading" aria-busy="true">
      <header className="cp-panel__head">
        <p className="eyebrow">{phase === "uploading" ? "Uploading" : "Starting"}</p>
        <h1 id="uploading-heading">
          {phase === "uploading" ? "Sending your photos…" : `Starting your gallery at ${venueName}…`}
        </h1>
        <p className="cp-lede">Keep this page open for a moment.</p>
      </header>
      <ul className="cp-uploads">
        {slots.map((photo, i) => {
          if (!photo) return null;
          const percent = photo.uploadedKey ? 100 : (photo.progress ?? 0);
          return (
            <li key={photo.id} className="cp-upload">
              <img src={photo.previewUrl} alt="" />
              <div className="cp-upload__body">
                <p className="cp-upload__label">
                  {COUPLE_REFERENCE_ROLES[i]}
                  <span>{photo.uploadedKey ? "Uploaded" : photo.progress !== null ? `${photo.progress}%` : "Waiting"}</span>
                </p>
                <div
                  className="cp-bar"
                  role="progressbar"
                  aria-label={`${COUPLE_REFERENCE_ROLES[i]} upload`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  data-testid={`upload-progress-${i}`}
                >
                  <span style={{ transform: `scaleX(${percent / 100})` }} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {phase === "starting" ? (
        <p className="cp-status" role="status">
          <Loader2 className="animate-spin" size={16} /> Photos uploaded. Opening your gallery page…
        </p>
      ) : null}
    </section>
  );
}

function CoupleSkeleton() {
  return (
    <div className="cc-page" aria-busy="true">
      <div className="cp-skeleton">
        <Skeleton className="cp-skeleton__bar" />
        <Skeleton className="cp-skeleton__media" />
        <Skeleton className="cp-skeleton__line" />
        <Skeleton className="cp-skeleton__line cp-skeleton__line--short" />
      </div>
    </div>
  );
}
