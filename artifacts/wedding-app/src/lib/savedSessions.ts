import { useEffect, useState, useCallback } from "react";

interface SavedSession {
  sessionId: number;
  shareToken: string | null;
  venueSlug: string;
  savedAt: string;
}

/** Session-scoped only - cleared when the browser tab closes (kiosk privacy). */
const STORAGE_KEY = "glimpse-my-sessions";

interface LegacySavedSession {
  sessionId: number;
  venueSlug: string;
  savedAt: string;
  shareToken?: string | null;
}

function readAll(): SavedSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LegacySavedSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => typeof s?.sessionId === "number" && typeof s?.venueSlug === "string")
      .map((s) => ({
        sessionId: s.sessionId,
        shareToken: typeof s.shareToken === "string" ? s.shareToken : null,
        venueSlug: s.venueSlug,
        savedAt: typeof s.savedAt === "string" ? s.savedAt : new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

function writeAll(items: SavedSession[]): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore quota errors
  }
}

/** Remove legacy localStorage entries that leaked sessions across couples on shared devices. */
export function clearLegacySavedSessions(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("wedding-saved-sessions");
  } catch {
    // ignore
  }
}

export function useSavedSessions(venueSlug?: string) {
  const [sessions, setSessions] = useState<SavedSession[]>([]);

  useEffect(() => {
    clearLegacySavedSessions();
    const all = readAll();
    setSessions(venueSlug ? all.filter((s) => s.venueSlug === venueSlug) : all);
  }, [venueSlug]);

  const save = useCallback(
    (shareToken: string | null | undefined, sessionId: number, slug: string) => {
      const all = readAll();
      if (all.some((s) => s.sessionId === sessionId)) return;
      const updated: SavedSession[] = [
        {
          sessionId,
          shareToken: shareToken ?? null,
          venueSlug: slug,
          savedAt: new Date().toISOString(),
        },
        ...all,
      ].slice(0, 20);
      writeAll(updated);
      setSessions(venueSlug ? updated.filter((s) => s.venueSlug === venueSlug) : updated);
    },
    [venueSlug],
  );

  const remove = useCallback(
    (sessionId: number) => {
      const all = readAll().filter((s) => s.sessionId !== sessionId);
      writeAll(all);
      setSessions(venueSlug ? all.filter((s) => s.venueSlug === venueSlug) : all);
    },
    [venueSlug],
  );

  return { sessions, save, remove };
}

interface RecoverRequestResult {
  accepted: boolean;
  error?: string;
}

export async function requestRecoveryEmail(email: string): Promise<RecoverRequestResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { accepted: false, error: "Enter an email address." };
  try {
    const res = await fetch("/api/sessions/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      accepted?: boolean;
      error?: string;
    };
    if (!res.ok) {
      return { accepted: false, error: data?.error ?? "Could not send recovery email." };
    }
    return { accepted: !!data?.accepted };
  } catch {
    return { accepted: false, error: "Network error. Try again." };
  }
}
