import type { SessionDetailResponse } from "@workspace/api-client-react";

function getShareUrl(session: SessionDetailResponse): string | null {
  if (!session.shareToken) return null;
  return `${window.location.origin}/v/${session.shareToken}`;
}

export async function copyShareLink(session: SessionDetailResponse): Promise<boolean> {
  const url = getShareUrl(session);
  if (!url) return false;
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export async function shareSession(
  session: SessionDetailResponse,
): Promise<"shared" | "copied" | "failed"> {
  const url = getShareUrl(session);
  if (!url) return "failed";

  const title = session.coupleName
    ? `${session.coupleName}'s Wedding Gallery`
    : "Our Wedding Gallery";
  const text = session.venue?.name
    ? `See our glimpse gallery at ${session.venue.name}`
    : "See our glimpse gallery";

  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return "shared";
    } catch (err) {
      if ((err as Error).name === "AbortError") return "failed";
    }
  }
  const copied = await copyShareLink(session);
  return copied ? "copied" : "failed";
}
