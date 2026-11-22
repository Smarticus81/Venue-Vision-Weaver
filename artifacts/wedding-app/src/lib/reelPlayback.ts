export type ReelPlaybackResult = "playing" | "paused" | "error";

export function shouldAutoplayReel(preferences: { reducedMotion: boolean; saveData: boolean }): boolean {
  return !preferences.reducedMotion && !preferences.saveData;
}

/** Playback permission is decided by the browser, not by an autoplay attribute. */
export async function playReel(video: Pick<HTMLVideoElement, "play">): Promise<ReelPlaybackResult> {
  try {
    await video.play();
    return "playing";
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    // An interrupted request (pause, tab switch, source change) is not a broken file.
    return name === "NotAllowedError" || name === "AbortError" ? "paused" : "error";
  }
}
