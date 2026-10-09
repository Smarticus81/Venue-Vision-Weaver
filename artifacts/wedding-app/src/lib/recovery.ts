/*
 * Getting back to a gallery: the "find my gallery" email request, and the
 * couple flow's in-tab draft so a refresh, a back swipe or an expired upload
 * token never wipes what the couple typed.
 *
 * The draft lives in sessionStorage only (cleared when the tab closes):
 * venues hand the same tablet to several couples on tour day. Photos are
 * never stored in the draft; they stay in memory until upload.
 */
import type { KeyValueStore } from "./shareSession";

/* ————— Recovery email ————— */

interface RecoverRequestResult {
  accepted: boolean;
  error?: string;
}

type RecoveryFetch = (input: string, init: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

export async function requestRecoveryEmail(
  email: string,
  send: RecoveryFetch = (input, init) => fetch(input, init),
): Promise<RecoverRequestResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { accepted: false, error: "Enter an email address." };
  try {
    const res = await send("/api/sessions/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed }),
    });
    const data = (await res.json().catch(() => ({}))) as { accepted?: boolean; error?: string };
    if (!res.ok) {
      return { accepted: false, error: data?.error ?? "We couldn't send the email. Try again in a few minutes." };
    }
    return { accepted: !!data?.accepted };
  } catch {
    return { accepted: false, error: "Network error. Try again." };
  }
}

/* ————— Legacy storage ————— */

/**
 * Removes the gallery lists older builds kept: a localStorage list that
 * leaked one couple's galleries to the next on shared devices, and the
 * write-only sessionStorage list that replaced it. Run once at boot.
 */
export function clearLegacyGalleryStorage(local: KeyValueStore | null, session: KeyValueStore | null): void {
  try {
    local?.removeItem("wedding-saved-sessions");
  } catch {
    /* blocked storage */
  }
  try {
    session?.removeItem("dreemer-my-sessions");
  } catch {
    /* blocked storage */
  }
}

/* ————— Couple flow draft ————— */

export const COUPLE_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const DRAFT_KEY_PREFIX = "dreemer:couple-draft:";

export interface CoupleDraft {
  step: number;
  styleId: string | null;
  coupleName: string;
  coupleEmail: string;
  weddingMonth: string;
}

interface StoredDraft extends CoupleDraft {
  v: 1;
  savedAt: number;
}

export const EMPTY_COUPLE_DRAFT: CoupleDraft = {
  step: 1,
  styleId: null,
  coupleName: "",
  coupleEmail: "",
  weddingMonth: "",
};

function draftKey(slug: string): string {
  return DRAFT_KEY_PREFIX + slug;
}

function clampText(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export function loadCoupleDraft(store: KeyValueStore | null, slug: string, now: number): CoupleDraft | null {
  if (!store || !slug) return null;
  try {
    const raw = store.getItem(draftKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== "number" || now - parsed.savedAt > COUPLE_DRAFT_TTL_MS) {
      store.removeItem(draftKey(slug));
      return null;
    }
    const step = typeof parsed.step === "number" && parsed.step >= 1 && parsed.step <= 3 ? Math.floor(parsed.step) : 1;
    return {
      step,
      styleId: typeof parsed.styleId === "string" && parsed.styleId ? parsed.styleId.slice(0, 80) : null,
      coupleName: clampText(parsed.coupleName, 80),
      coupleEmail: clampText(parsed.coupleEmail, 254),
      weddingMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(parsed.weddingMonth ?? "") ? parsed.weddingMonth! : "",
    };
  } catch {
    return null;
  }
}

export function saveCoupleDraft(store: KeyValueStore | null, slug: string, draft: CoupleDraft, now: number): void {
  if (!store || !slug) return;
  const stored: StoredDraft = { v: 1, savedAt: now, ...draft };
  try {
    store.setItem(draftKey(slug), JSON.stringify(stored));
  } catch {
    /* storage full or blocked: the flow still works, it just won't survive a refresh */
  }
}

export function clearCoupleDraft(store: KeyValueStore | null, slug: string): void {
  if (!store || !slug) return;
  try {
    store.removeItem(draftKey(slug));
  } catch {
    /* blocked storage */
  }
}

/**
 * The step a restored draft may reopen on. Photos never survive a reload,
 * so a draft saved on the style step reopens on the photo step.
 */
export function resumableStep(draft: CoupleDraft | null, photoCount: number, minPhotos: number): number {
  if (!draft) return 1;
  if (draft.step >= 3 && photoCount < minPhotos) return 2;
  return Math.min(Math.max(draft.step, 1), 3);
}
