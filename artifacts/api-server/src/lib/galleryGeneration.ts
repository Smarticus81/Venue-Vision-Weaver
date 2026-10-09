import {
  db,
  coupleSessionsTable,
  generatedAssetsTable,
  type CoupleSession,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { polishGalleryFrame } from "./galleryFrame.js";
import {
  configuredImageModels,
  generateCinematicStillWithMetadata,
  GeneratedStillRejectedError,
  type GeneratedStillResult,
} from "./stillImageClient.js";
import { buildKenBurnsSlideshow } from "./motionReel.js";
import type { GalleryStyle } from "./galleryStyles.js";
import {
  buildSceneKontextPrompt,
  planGalleryScenes,
  type WeddingScene,
} from "./scenePlan.js";
import { rankVenueReferencesForScene } from "./venueReferenceSelector.js";
import {
  GalleryJudgeUnavailableError,
  GalleryQualityError,
  acceptanceFloorFailures,
  assertGalleryFrameQuality,
  frameQualityScore,
  qualityRetryGuidanceForError,
  type GalleryQualityReport,
  type JudgeFrameParams,
} from "./galleryQuality.js";
import { hasCompletePublicGalleryAssets, persistedDeliveryHold } from "./sessionVisibility.js";
import { logger } from "./logger.js";
import {
  StillImageBlockedError,
  StillImageRequestError,
  isAbortOrTimeoutError,
  modelForError,
} from "./stillImageErrors.js";
import {
  recordModelFallback,
  recordRenderAttempt,
  type RenderAttemptInput,
} from "./renderTelemetry.js";
import {
  preferredVenueCoveragesForScene,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";
import type { RenderAttemptOutcome } from "@workspace/db";

const MAX_TOTAL_REFERENCE_IMAGES = 14;
const MAX_COUPLE_REFERENCES = 3;

function frameAttempts(): number {
  const parsed = Number(process.env.GALLERY_FRAME_ATTEMPTS ?? "4");
  return Number.isFinite(parsed) ? Math.max(1, Math.min(5, Math.round(parsed))) : 4;
}

/** Scene renders allowed in flight across the whole process (provider rate-limit guard). */
export function renderConcurrencyFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.GALLERY_RENDER_CONCURRENCY ?? "4");
  return Number.isFinite(parsed) ? Math.max(1, Math.min(16, Math.round(parsed))) : 4;
}

type ImageRef = { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };

/** How the shipped frame relates to the quality gate. */
export type FrameJudgeStatus =
  /** Met every strict target. */
  | "passed"
  /** Best attempt missed a target but cleared every floor and integrity check. */
  | "below_target"
  /** The judge was unavailable after its retries; a human must review before delivery. */
  | "unjudged"
  /** GALLERY_QUALITY_GATE=off (local plumbing only). */
  | "gate_off";

export interface GalleryFrameRenderResult {
  raw: Buffer;
  qualityReport: GalleryQualityReport | null;
  judgeStatus: FrameJudgeStatus;
  venueReferenceIndexes: number[];
  attempts: number;
  model: string;
  fallbackUsed: boolean;
}

/** Injected collaborators; tests replace them with stubs (no network, no DB). */
export interface GalleryRenderDeps {
  generateStill: (
    params: Parameters<typeof generateCinematicStillWithMetadata>[0],
  ) => Promise<GeneratedStillResult>;
  judgeFrame: (params: JudgeFrameParams) => Promise<GalleryQualityReport | null>;
  rankVenueReferences: (
    scene: WeddingScene,
    refs: ImageRef[],
    signal?: AbortSignal,
  ) => Promise<number[]>;
  recordAttempt: (input: RenderAttemptInput) => Promise<void>;
  recordFallback: typeof recordModelFallback;
  primaryModel: () => string;
  now: () => number;
}

export const defaultGalleryRenderDeps: GalleryRenderDeps = {
  generateStill: generateCinematicStillWithMetadata,
  judgeFrame: (params) => assertGalleryFrameQuality(params),
  rankVenueReferences: rankVenueReferencesForScene,
  recordAttempt: recordRenderAttempt,
  recordFallback: recordModelFallback,
  primaryModel: () => configuredImageModels()[0] ?? "unknown",
  now: () => Date.now(),
};

/**
 * Venue reference order for one scene: the scene's preferred coverage slots
 * first (exterior for the wide shot, detail for the close one...), each
 * coverage group ordered by the selector's ranking, then the rest of the
 * ranking, then every remaining photo. The first index is the scene anchor.
 */
export function orderVenueReferenceIndexes(
  sceneId: string,
  refs: Array<{ coverage?: VenueMediaCoverage | null }>,
  rankedIndexes: number[],
): number[] {
  const rankPosition = new Map<number, number>();
  rankedIndexes.forEach((index, position) => {
    if (!rankPosition.has(index)) rankPosition.set(index, position);
  });
  const byRank = (a: number, b: number) =>
    (rankPosition.get(a) ?? Number.MAX_SAFE_INTEGER) - (rankPosition.get(b) ?? Number.MAX_SAFE_INTEGER) ||
    a - b;
  const coverageIndexes = preferredVenueCoveragesForScene(sceneId).flatMap((coverage) =>
    refs
      .flatMap((ref, index) => (ref.coverage === coverage ? [index] : []))
      .sort(byRank),
  );
  const ordered = [
    ...coverageIndexes,
    ...rankedIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < refs.length),
    ...refs.map((_, index) => index),
  ];
  return [...new Set(ordered)];
}

async function selectVenueReferences(
  scene: WeddingScene,
  venueBuffers: ImageRef[],
  deps: GalleryRenderDeps,
  signal?: AbortSignal,
): Promise<{ sceneVenueRef: ImageRef; venueRefs: ImageRef[]; venueReferenceIndexes: number[] }> {
  const rankedIndexes = await deps.rankVenueReferences(scene, venueBuffers, signal);
  const maxVenueReferences = Math.max(1, MAX_TOTAL_REFERENCE_IMAGES - MAX_COUPLE_REFERENCES);
  const venueReferenceIndexes = orderVenueReferenceIndexes(scene.id, venueBuffers, rankedIndexes).slice(
    0,
    maxVenueReferences,
  );
  const venueRefs = venueReferenceIndexes.map((index) => venueBuffers[index]!);
  return {
    sceneVenueRef: venueRefs[0] ?? venueBuffers[0]!,
    venueRefs,
    venueReferenceIndexes,
  };
}

/** render_attempts outcome + error class for a failed render call. */
export function classifyRenderFailure(err: unknown): { outcome: RenderAttemptOutcome; errorClass: string } {
  if (err instanceof StillImageBlockedError) return { outcome: "blocked", errorClass: "blocked" };
  if (err instanceof StillImageRequestError) {
    if (err.timedOut) return { outcome: "timeout", errorClass: "timeout" };
    return {
      outcome: "error",
      errorClass: err.retryWithFallbackModel ? "provider_unavailable" : `provider_http_${err.status}`,
    };
  }
  if (isAbortOrTimeoutError(err)) return { outcome: "timeout", errorClass: "timeout" };
  if (err instanceof GeneratedStillRejectedError) return { outcome: "error", errorClass: "invalid_output" };
  return { outcome: "error", errorClass: "provider_error" };
}

function reportJson(report: GalleryQualityReport | null): Record<string, unknown> | null {
  return report ? (report as unknown as Record<string, unknown>) : null;
}

/**
 * Render one scene. Render attempts and judge attempts are separate budgets:
 * the judge retries its own outages on the same frame (galleryQuality), and
 * only a frame the judge actually scored below target costs another render.
 * Blocked content stops the scene at once (the same photos would be blocked
 * again). Every attempt lands in render_attempts.
 */
export async function renderGalleryFrameWithQuality(
  ctx: {
    sessionId: number;
    scene: WeddingScene;
    style: GalleryStyle;
    sceneIndex: number;
    coupleBuffers: ImageRef[];
    venueBuffers: ImageRef[];
    signal?: AbortSignal;
  },
  deps: GalleryRenderDeps = defaultGalleryRenderDeps,
): Promise<GalleryFrameRenderResult> {
  const { sessionId, scene, style, sceneIndex, coupleBuffers, venueBuffers, signal } = ctx;
  const { sceneVenueRef, venueRefs, venueReferenceIndexes } = await selectVenueReferences(
    scene,
    venueBuffers,
    deps,
    signal,
  );
  const coupleRefs = coupleBuffers.slice(0, MAX_COUPLE_REFERENCES);
  const maxAttempts = frameAttempts();
  const basePrompt = buildSceneKontextPrompt(scene, style);

  let lastErr: unknown = null;
  let retryGuidance: string | null = null;
  let bestFallback: {
    score: number;
    raw: Buffer;
    report: GalleryQualityReport;
    model: string;
    fallbackUsed: boolean;
  } | null = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();
    attemptsMade = attempt;
    const started = deps.now();
    let generated: GeneratedStillResult;
    try {
      generated = await deps.generateStill({
        prompt: retryGuidance ? `${basePrompt}\n\n${retryGuidance}` : basePrompt,
        coupleReference: coupleRefs[0]!,
        coupleReferences: coupleRefs,
        venueReference: sceneVenueRef,
        venueReferences: venueRefs,
        aspectRatio: scene.aspectRatio,
        signal,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      const { outcome, errorClass } = classifyRenderFailure(err);
      await deps.recordAttempt({
        sessionId,
        sceneId: scene.id,
        attempt,
        model: modelForError(err) ?? deps.primaryModel(),
        latencyMs: deps.now() - started,
        outcome,
        errorClass,
      });
      logger.warn(
        { err, sessionId, sceneId: scene.id, sceneIndex, attempt, maxAttempts, outcome },
        "Gallery frame render attempt failed",
      );
      if (err instanceof StillImageBlockedError) throw err;
      lastErr = err;
      continue;
    }

    const renderTelemetry = {
      sessionId,
      sceneId: scene.id,
      attempt,
      model: generated.model,
      fallbackUsed: generated.fallbackUsed,
      size: generated.size,
      quality: generated.quality,
      inputTokens: generated.usage?.inputTokens ?? null,
      outputTokens: generated.usage?.outputTokens ?? null,
      latencyMs: deps.now() - started,
    };
    if (generated.fallbackUsed) {
      void deps.recordFallback({
        sessionId,
        sceneId: scene.id,
        primaryModel: generated.primaryModel,
        model: generated.model,
        skipped: generated.fallbackFrom,
      });
    }

    try {
      const qualityReport = await deps.judgeFrame({
        sessionId,
        scene,
        generated: { buffer: generated.buffer, mimeType: "image/jpeg" },
        generatedModel: generated.model,
        coupleReferences: coupleRefs,
        venueReferences: venueRefs,
        signal,
      });
      await deps.recordAttempt({ ...renderTelemetry, judgeReport: reportJson(qualityReport), outcome: "accepted" });
      return {
        raw: generated.buffer,
        qualityReport,
        judgeStatus: qualityReport ? "passed" : "gate_off",
        venueReferenceIndexes,
        attempts: attempt,
        model: generated.model,
        fallbackUsed: generated.fallbackUsed,
      };
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof GalleryQualityError) {
        await deps.recordAttempt({
          ...renderTelemetry,
          judgeReport: reportJson(err.report),
          outcome: "rejected",
          errorClass: "quality_below_target",
        });
        // A frame that missed the strict targets is still a candidate: keep the
        // best-scoring one so imperfect input photos degrade the gallery
        // gracefully instead of failing the whole session.
        const score = frameQualityScore(err.report);
        if (!bestFallback || score > bestFallback.score) {
          bestFallback = {
            score,
            raw: generated.buffer,
            report: err.report,
            model: generated.model,
            fallbackUsed: generated.fallbackUsed,
          };
        }
        const nextGuidance = qualityRetryGuidanceForError(err);
        if (nextGuidance) retryGuidance = nextGuidance;
        lastErr = err;
        logger.warn(
          { sessionId, sceneId: scene.id, sceneIndex, attempt, maxAttempts, adaptiveRetry: Boolean(nextGuidance) },
          "Gallery frame missed the quality targets",
        );
        continue;
      }
      if (err instanceof GalleryJudgeUnavailableError) {
        // The judge is down, not the frame. Rendering again would only buy
        // more unjudged frames, so stop here: ship the best judged frame if one
        // cleared the floors, otherwise this one, unjudged and held for review.
        if (bestFallback && acceptanceFloorFailures(bestFallback.report).length === 0) {
          await deps.recordAttempt({ ...renderTelemetry, outcome: "error", errorClass: "judge_unavailable" });
          return {
            raw: bestFallback.raw,
            qualityReport: bestFallback.report,
            judgeStatus: "below_target",
            venueReferenceIndexes,
            attempts: attempt,
            model: bestFallback.model,
            fallbackUsed: bestFallback.fallbackUsed,
          };
        }
        await deps.recordAttempt({ ...renderTelemetry, outcome: "accepted", errorClass: "judge_unavailable" });
        logger.error(
          { err, sessionId, sceneId: scene.id, sceneIndex, attempt },
          "Gallery quality judge unavailable; frame held for owner review",
        );
        return {
          raw: generated.buffer,
          qualityReport: null,
          judgeStatus: "unjudged",
          venueReferenceIndexes,
          attempts: attempt,
          model: generated.model,
          fallbackUsed: generated.fallbackUsed,
        };
      }
      await deps.recordAttempt({ ...renderTelemetry, outcome: "error", errorClass: "judge_error" });
      logger.warn({ err, sessionId, sceneId: scene.id, attempt }, "Gallery frame judging failed");
      lastErr = err;
    }
  }

  if (bestFallback) {
    const floorFailures = acceptanceFloorFailures(bestFallback.report);
    if (floorFailures.length === 0) {
      logger.info(
        { sessionId, sceneId: scene.id, sceneIndex, attempts: attemptsMade, score: bestFallback.score },
        "Accepting best-effort gallery frame below target thresholds (flagged for the owner)",
      );
      return {
        raw: bestFallback.raw,
        qualityReport: bestFallback.report,
        judgeStatus: "below_target",
        venueReferenceIndexes,
        attempts: attemptsMade,
        model: bestFallback.model,
        fallbackUsed: bestFallback.fallbackUsed,
      };
    }
    logger.warn(
      { sessionId, sceneId: scene.id, sceneIndex, floorFailures },
      "Best gallery frame attempt is below the acceptance floor",
    );
    // Fail with the BEST attempt's report so the stored detail reflects how
    // close the photos got, not whichever attempt happened to run last.
    throw new GalleryQualityError(
      `Best gallery frame attempt is below the acceptance floor: ${floorFailures.join("; ")}`,
      bestFallback.report,
      { buffer: bestFallback.raw, mimeType: "image/jpeg" },
      bestFallback.model,
    );
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gallery frame generation failed");
}

/* --------------------------------------------------------------- semaphore */

/** FIFO counting semaphore; waiting callers leave the queue when their signal aborts. */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly capacity: number) {}

  get inUse(): number {
    return this.active;
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.capacity) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        this.active += 1;
        resolve();
      };
      const onAbort = () => {
        const index = this.waiters.indexOf(grant);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiters.push(grant);
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const renderSlots = new Semaphore(renderConcurrencyFromEnv());

/* ------------------------------------------------------------ gallery run */

export interface GalleryAssetRow {
  objectKey: string;
  assetType: string;
  displayOrder: number;
}

/** Persistence used by a gallery run; the default writes generated_assets / couple_sessions. */
export interface GalleryStore {
  listAssets(sessionId: number): Promise<GalleryAssetRow[]>;
  insertAsset(row: {
    sessionId: number;
    objectKey: string;
    assetType: "image" | "video";
    displayOrder: number;
    generationModel?: string | null;
    generationAttempts?: number | null;
    venueReferenceIndexes?: number[] | null;
    qualityReport?: Record<string, unknown> | null;
  }): Promise<void>;
  /** Remove an asset row; returns its object key so the caller can delete the object. */
  deleteAsset(sessionId: number, assetType: string, displayOrder: number): Promise<string | null>;
  /**
   * processing -> ready, only while the session is still processing (the
   * deadline may have failed it). The owner hold is written in the same
   * update, so the share link never sees a held gallery as deliverable.
   */
  markReady(sessionId: number, options?: { deliveryHoldReason?: string | null }): Promise<CoupleSession | null>;
}

export interface GalleryGenerationContext {
  session: CoupleSession;
  style: GalleryStyle;
  coupleBuffers: ImageRef[];
  venueBuffers: ImageRef[];
  venueName?: string | null;
  uploadBuffer: (buffer: Buffer, contentType: string) => Promise<string>;
  /** Best-effort object deletion (stale reel replaced on resume). */
  deleteObject?: (objectKey: string) => Promise<void>;
  /**
   * Polished stills kept from an earlier run of this session, by display
   * order (1-4). Those scenes are not rendered again.
   */
  existingFrames?: Map<number, Buffer>;
  /** The venue reviews every gallery before the couple gets it (persisted as a delivery hold). */
  reviewBeforeSend?: boolean | null;
  signal?: AbortSignal;
}

export interface SceneOutcome {
  sceneId: string;
  displayOrder: number;
  status: "rendered" | "reused" | "failed";
  judgeStatus?: FrameJudgeStatus;
  attempts?: number;
  model?: string;
  fallbackUsed?: boolean;
  error?: unknown;
}

export interface GalleryGenerationResult {
  /** The session row after it was marked ready, or null when the deadline got there first. */
  readySession: CoupleSession | null;
  scenes: SceneOutcome[];
  /** At least one frame shipped without a judge verdict (owner must review). */
  needsReview: boolean;
  belowTargetFrames: number;
  fallbackUsed: boolean;
}

/** A scene failed; the frames that did render are kept for a retry. */
export class GallerySceneFailureError extends Error {
  constructor(
    public readonly scenes: SceneOutcome[],
    public readonly primary: unknown,
  ) {
    super(primary instanceof Error ? primary.message : "Gallery scene generation failed");
    this.name = "GallerySceneFailureError";
  }
}

/**
 * The failure that best explains a run: blocked content first (the couple
 * must change photos), then a quality miss, then anything else.
 */
export function primarySceneError(errors: unknown[]): unknown {
  return (
    errors.find((err) => err instanceof StillImageBlockedError) ??
    errors.find((err) => err instanceof GalleryQualityError) ??
    errors[0]
  );
}

export interface GalleryRunDeps extends GalleryRenderDeps {
  store: GalleryStore;
  polish: (raw: Buffer, sceneIndex: number) => Promise<Buffer>;
  buildReel: (slides: Buffer[], venueName: string | null | undefined, signal?: AbortSignal) => Promise<Buffer>;
  slots: Semaphore;
}

/**
 * Render the four scenes concurrently (bounded by the process-wide render
 * semaphore), store each accepted frame as soon as it exists, build the reel
 * and mark the session ready. When a scene fails, the other scenes still
 * finish and their frames stay stored, so a retry renders only what failed.
 */
export async function processGallerySession(
  ctx: GalleryGenerationContext,
  deps: GalleryRunDeps = defaultGalleryRunDeps(),
): Promise<GalleryGenerationResult> {
  const { session, style, coupleBuffers, venueBuffers, uploadBuffer, signal } = ctx;
  const sessionId = session.id;
  const scenes = planGalleryScenes();
  const existing = ctx.existingFrames ?? new Map<number, Buffer>();
  const polishedSlides: Array<Buffer | null> = scenes.map(() => null);

  const settled = await Promise.allSettled(
    scenes.map(async (scene, i): Promise<SceneOutcome> => {
      const displayOrder = i + 1;
      const kept = existing.get(displayOrder);
      if (kept) {
        polishedSlides[i] = kept;
        return { sceneId: scene.id, displayOrder, status: "reused" };
      }
      return deps.slots.run(async () => {
        logger.info(
          { sessionId, sceneId: scene.id, sceneIndex: displayOrder, aspectRatio: scene.aspectRatio },
          "Rendering gallery still",
        );
        const result = await renderGalleryFrameWithQuality(
          { sessionId, scene, style, sceneIndex: i, coupleBuffers, venueBuffers, signal },
          deps,
        );
        signal?.throwIfAborted();
        const polished = await deps.polish(result.raw, i);
        const imageKey = await uploadBuffer(polished, "image/jpeg");
        await deps.store.insertAsset({
          sessionId,
          objectKey: imageKey,
          assetType: "image",
          displayOrder,
          generationModel: result.model,
          generationAttempts: result.attempts,
          venueReferenceIndexes: result.venueReferenceIndexes,
          qualityReport: result.qualityReport
            ? { ...(result.qualityReport as unknown as Record<string, unknown>), judgeStatus: result.judgeStatus }
            : { judgeStatus: result.judgeStatus },
        });
        polishedSlides[i] = polished;
        return {
          sceneId: scene.id,
          displayOrder,
          status: "rendered",
          judgeStatus: result.judgeStatus,
          attempts: result.attempts,
          model: result.model,
          fallbackUsed: result.fallbackUsed,
        };
      }, signal);
    }),
  );

  signal?.throwIfAborted();
  const outcomes: SceneOutcome[] = settled.map((entry, i) =>
    entry.status === "fulfilled"
      ? entry.value
      : { sceneId: scenes[i]!.id, displayOrder: i + 1, status: "failed", error: entry.reason },
  );
  const failures = outcomes.filter((outcome) => outcome.status === "failed");
  if (failures.length > 0) {
    throw new GallerySceneFailureError(outcomes, primarySceneError(failures.map((f) => f.error)));
  }

  // A reel left over from an earlier run no longer matches the frames; replace it.
  const staleReelKey = await deps.store.deleteAsset(sessionId, "video", 0);
  if (staleReelKey && ctx.deleteObject) {
    await ctx.deleteObject(staleReelKey).catch((err) =>
      logger.warn({ err, sessionId, objectKey: staleReelKey }, "Failed to delete stale motion reel"),
    );
  }

  logger.info({ sessionId, venueName: ctx.venueName }, "Building motion reel from gallery stills");
  const reelBuffer = await deps.buildReel(polishedSlides as Buffer[], ctx.venueName, signal);
  signal?.throwIfAborted();
  const reelKey = await uploadBuffer(reelBuffer, "video/mp4");
  await deps.store.insertAsset({ sessionId, objectKey: reelKey, assetType: "video", displayOrder: 0 });

  const publicAssets = await deps.store.listAssets(sessionId);
  if (!hasCompletePublicGalleryAssets(publicAssets)) {
    throw new Error(
      "Generated gallery is incomplete; refusing to mark session ready until four stills and one motion reel exist.",
    );
  }

  const rendered = outcomes.filter((outcome) => outcome.status === "rendered");
  const needsReview = rendered.some((outcome) => outcome.judgeStatus === "unjudged");
  const readySession = await deps.store.markReady(sessionId, {
    deliveryHoldReason: persistedDeliveryHold({
      kind: ctx.session.kind,
      reviewBeforeSend: ctx.reviewBeforeSend,
      needsReview,
    }),
  });
  logger.info(
    {
      sessionId,
      ready: Boolean(readySession),
      rendered: rendered.length,
      reused: outcomes.length - rendered.length,
    },
    readySession ? "Gallery generation complete" : "Gallery finished after the session left processing; not marked ready",
  );
  return {
    readySession,
    scenes: outcomes,
    needsReview,
    belowTargetFrames: rendered.filter((outcome) => outcome.judgeStatus === "below_target").length,
    fallbackUsed: rendered.some((outcome) => outcome.fallbackUsed),
  };
}

export const dbGalleryStore: GalleryStore = {
  async listAssets(sessionId) {
    return db
      .select({
        objectKey: generatedAssetsTable.objectKey,
        assetType: generatedAssetsTable.assetType,
        displayOrder: generatedAssetsTable.displayOrder,
      })
      .from(generatedAssetsTable)
      .where(eq(generatedAssetsTable.sessionId, sessionId));
  },
  async insertAsset(row) {
    await db.insert(generatedAssetsTable).values({
      sessionId: row.sessionId,
      objectKey: row.objectKey,
      assetType: row.assetType,
      displayOrder: row.displayOrder,
      generationModel: row.generationModel ?? null,
      generationAttempts: row.generationAttempts ?? null,
      venueReferenceIndexes: row.venueReferenceIndexes ?? null,
      qualityReport: row.qualityReport ?? null,
    });
  },
  async deleteAsset(sessionId, assetType, displayOrder) {
    const [deleted] = await db
      .delete(generatedAssetsTable)
      .where(
        and(
          eq(generatedAssetsTable.sessionId, sessionId),
          eq(generatedAssetsTable.assetType, assetType),
          eq(generatedAssetsTable.displayOrder, displayOrder),
        ),
      )
      .returning({ objectKey: generatedAssetsTable.objectKey });
    return deleted?.objectKey ?? null;
  },
  async markReady(sessionId, options = {}) {
    const [updated] = await db
      .update(coupleSessionsTable)
      .set({
        status: "ready",
        completedAt: new Date(),
        errorMessage: null,
        failureDetail: null,
        deliveryHoldReason: options.deliveryHoldReason ?? null,
      })
      .where(and(eq(coupleSessionsTable.id, sessionId), eq(coupleSessionsTable.status, "processing")))
      .returning();
    return updated ?? null;
  },
};

export function defaultGalleryRunDeps(): GalleryRunDeps {
  return {
    ...defaultGalleryRenderDeps,
    store: dbGalleryStore,
    polish: (raw, sceneIndex) => polishGalleryFrame(raw, { sceneIndex }),
    buildReel: (slides, venueName, signal) => buildKenBurnsSlideshow(slides, 4, { venueName }, signal),
    slots: renderSlots,
  };
}

export { describeGalleryFailure, userMessageForStillError } from "./stillImageClient.js";
