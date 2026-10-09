import { useCallback, useEffect, useRef, useState } from "react";
import { useCreateSession, type CreateSessionBodyCreatedVia, type SessionResponse } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { addCouplePhotos, createSessionErrorCopy, MAX_COUPLE_PHOTOS } from "./capture";
import { apiErrorMessage, describeApiError } from "./errors";

/**
 * Shared state for starting a couple's gallery: the 2-3 photos (with
 * previews), names, email, wedding month, consent and style; uploads each
 * photo once (a retry after a failed create reuses the uploaded keys), then
 * calls POST /venues/{slug}/sessions. Used by Create a gallery and by
 * tour-day mode, which passes createdVia "tour_day".
 */

export interface CapturePhoto {
  id: string;
  file: File;
  preview: string;
  /** Set once the photo is in storage; reused on retry. */
  objectPath: string | null;
}

export type CaptureStage = "idle" | "uploading" | "creating";

export interface CaptureFailure {
  message: string;
  /** trial_expired | insufficient_credits when the server refused to spend. */
  spendCode: "trial_expired" | "insufficient_credits" | null;
}

let photoSeq = 0;

export function useCoupleCapture({
  slug,
  createdVia,
  onCreated,
}: {
  slug: string;
  createdVia?: CreateSessionBodyCreatedVia;
  onCreated?: (session: SessionResponse) => void;
}) {
  const [photos, setPhotos] = useState<CapturePhoto[]>([]);
  const [coupleName, setCoupleName] = useState("");
  const [coupleEmail, setCoupleEmail] = useState("");
  const [weddingMonth, setWeddingMonth] = useState<string>("");
  const [consent, setConsent] = useState(false);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [stage, setStage] = useState<CaptureStage>("idle");
  const [failure, setFailure] = useState<CaptureFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const photosRef = useRef<CapturePhoto[]>([]);
  photosRef.current = photos;

  const createSession = useCreateSession();
  const lastUploadError = useRef<string | null>(null);
  const { uploadFile } = useUpload({
    purpose: "couple",
    venueSlug: slug,
    onError: (err) => {
      lastUploadError.current = err.message;
    },
  });

  useEffect(
    () => () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
    },
    [],
  );

  const addFiles = useCallback((picked: File[]) => {
    const current = photosRef.current;
    const selection = addCouplePhotos(
      current.map((p) => p.file),
      picked,
      MAX_COUPLE_PHOTOS,
    );
    const added = selection.accepted.slice(current.length);
    if (selection.rejectedType > 0) setNotice("Use JPG, PNG or WebP photos.");
    else if (selection.overflow > 0) setNotice(`Three photos is the most a gallery uses.`);
    else setNotice(null);
    if (added.length === 0) return;
    setPhotos((prev) => [
      ...prev,
      ...added.map((file) => ({
        id: `p${++photoSeq}`,
        file,
        preview: URL.createObjectURL(file),
        objectPath: null,
      })),
    ]);
    setFailure(null);
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((p) => p.id !== id);
    });
  }, []);

  const reset = useCallback(() => {
    photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setCoupleName("");
    setCoupleEmail("");
    setWeddingMonth("");
    setConsent(false);
    setFailure(null);
    setNotice(null);
    setStage("idle");
  }, []);

  const forgetUploads = () => setPhotos((prev) => prev.map((p) => ({ ...p, objectPath: null })));

  const submit = useCallback(async (): Promise<SessionResponse | null> => {
    setFailure(null);
    setStage("uploading");
    lastUploadError.current = null;
    const keys: string[] = [];
    try {
      for (const photo of photosRef.current) {
        if (photo.objectPath) {
          keys.push(photo.objectPath);
          continue;
        }
        const uploaded = await uploadFile(photo.file);
        if (!uploaded) {
          throw new Error(lastUploadError.current ?? "A photo did not upload. Check the connection and try again.");
        }
        keys.push(uploaded.objectPath);
        setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, objectPath: uploaded.objectPath } : p)));
      }
    } catch (err) {
      setStage("idle");
      setFailure({ message: err instanceof Error ? err.message : "Upload failed.", spendCode: null });
      return null;
    }

    setStage("creating");
    try {
      const session = await createSession.mutateAsync({
        slug,
        data: {
          couplePhotoKeys: keys,
          coupleEmail: coupleEmail.trim().toLowerCase(),
          coupleName: coupleName.trim() || undefined,
          weddingMonth: weddingMonth || undefined,
          consent: true,
          styleId: styleId ?? undefined,
          createdVia,
        },
      });
      setStage("idle");
      onCreated?.(session);
      return session;
    } catch (err) {
      const { code } = describeApiError(err);
      if (code === "stale_upload") forgetUploads();
      const spendCode = code === "trial_expired" || code === "insufficient_credits" ? code : null;
      setFailure({
        message: createSessionErrorCopy(code, apiErrorMessage(err, "The gallery did not start. Try again.")),
        spendCode,
      });
      setStage("idle");
      return null;
    }
  }, [coupleEmail, coupleName, createSession, createdVia, onCreated, slug, styleId, uploadFile, weddingMonth]);

  return {
    photos,
    addFiles,
    removePhoto,
    coupleName,
    setCoupleName,
    coupleEmail,
    setCoupleEmail,
    weddingMonth,
    setWeddingMonth,
    consent,
    setConsent,
    styleId,
    setStyleId,
    stage,
    busy: stage !== "idle",
    failure,
    notice,
    submit,
    reset,
  };
}

export type CoupleCapture = ReturnType<typeof useCoupleCapture>;
