import type { RenderAttemptInput } from "../lib/renderTelemetry.js";

export type QaRenderAttempt = Omit<RenderAttemptInput, "sessionId">;

/** Record before a scene succeeds, so thrown scenes retain their paid work. */
export function appendQaAttempt(log: QaRenderAttempt[], input: RenderAttemptInput): QaRenderAttempt {
  const { sessionId: _sessionId, ...attempt } = input;
  log.push(attempt);
  return attempt;
}

export function summarizeQaAttemptCounts(attempts: readonly QaRenderAttempt[]) {
  const byScene = new Map<string, number>();
  for (const attempt of attempts) {
    byScene.set(attempt.sceneId, (byScene.get(attempt.sceneId) ?? 0) + 1);
  }
  return {
    totalAttempts: attempts.length,
    maxAttemptsOnFrame: Math.max(0, ...byScene.values()),
  };
}
