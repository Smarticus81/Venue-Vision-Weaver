import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests (every collaborator is stubbed), but the module
// refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.LOG_LEVEL ??= "silent";

const {
  GallerySceneFailureError,
  Semaphore,
  orderVenueReferenceIndexes,
  processGallerySession,
  renderGalleryFrameWithQuality,
} = await import("./galleryGeneration.js");
const { GalleryJudgeUnavailableError, GalleryQualityError } = await import("./galleryQuality.js");
const { StillImageBlockedError, StillImageRequestError, SessionDeadlineError } = await import("./stillImageErrors.js");
const { createSessionWorker, REAPER_GRACE_MS, sessionDeadlineMsFromEnv, maxConcurrentSessionsFromEnv } =
  await import("./sessionWorker.js");
const { deliverReadyGallery, deliveryHoldReason, failSession, failureDetailFor, reconcileFailedRefunds } = await import(
  "./gallerySessionPipeline.js"
);
const { refundableSessionWhere } = await import("./credits.js");
const { db, coupleSessionsTable } = await import("@workspace/db");
const { renderPriceEnvKey, renderUnitPriceUsd, summarizeRenderCost } = await import("./renderTelemetry.js");
const { composeReelFrame, kenBurnsFilter, strokeTextFor, buildReelTitleCard, layoutVenueTitle } = await import(
  "./motionReel.js"
);
const { GALLERY_STYLES } = await import("./galleryStyles.js");
const { planGalleryScenes } = await import("./scenePlan.js");

import type { GalleryRunDeps, GalleryStore } from "./galleryGeneration.js";
import type { RenderAttemptInput } from "./renderTelemetry.js";
import type { GalleryQualityReport } from "./galleryQuality.js";
import type { CoupleSession } from "@workspace/db";

const style = GALLERY_STYLES[0]!;
const scene = planGalleryScenes()[0]!;
const ref = { buffer: Buffer.from("ref"), mimeType: "image/jpeg" };

const goodReport: GalleryQualityReport = {
  likenessScore: 0.9,
  partnerOneLikenessScore: 0.9,
  partnerTwoLikenessScore: 0.9,
  partnerIdentitySeparation: true,
  venueScore: 0.9,
  compositionScore: 0.9,
  exactlyTwoPartners: true,
  facesVisible: true,
  extraPeople: false,
  textArtifacts: false,
  pass: true,
  reasons: [],
};
const belowTargetReport: GalleryQualityReport = { ...goodReport, partnerTwoLikenessScore: 0.7, pass: false };

function stillResult(model = "gpt-image-2.5-sunburst") {
  return {
    buffer: Buffer.from(`frame-${model}`),
    model,
    primaryModel: "gpt-image-2.5-sunburst",
    fallbackUsed: model !== "gpt-image-2.5-sunburst",
    fallbackFrom: model !== "gpt-image-2.5-sunburst" ? [{ model: "gpt-image-2.5-sunburst", reason: "http_503" }] : [],
    size: "1344x1792",
    quality: "high",
    usage: { inputTokens: 1000, outputTokens: 4000 },
  };
}

function stubDeps(overrides: Partial<GalleryRunDeps> = {}) {
  const attempts: RenderAttemptInput[] = [];
  const fallbacks: unknown[] = [];
  let clock = 0;
  const deps = {
    generateStill: async () => stillResult(),
    judgeFrame: async () => goodReport,
    rankVenueReferences: async (_scene: unknown, refs: unknown[]) => refs.map((_, index) => index),
    recordAttempt: async (input: RenderAttemptInput) => {
      attempts.push(input);
    },
    recordFallback: async (input: unknown) => {
      fallbacks.push(input);
    },
    primaryModel: () => "gpt-image-2.5-sunburst",
    now: () => (clock += 250),
    ...overrides,
  } as GalleryRunDeps;
  return { deps, attempts, fallbacks };
}

function qualityError(report: GalleryQualityReport) {
  return new GalleryQualityError("missed", report, { buffer: Buffer.from("x"), mimeType: "image/jpeg" }, "gpt-image-2.5-sunburst");
}

/* ------------------------------------------------------- reference order */

test("venue references put the scene's preferred coverage first, ranked within each coverage group", () => {
  const refs = [
    { coverage: "detail" as const },
    { coverage: "reception" as const },
    { coverage: "exterior" as const },
    { coverage: "exterior" as const },
    { coverage: null },
    { coverage: "ceremony" as const },
  ];
  // grand-venue prefers exterior, ceremony, reception, natural_light; the
  // ranking prefers the second exterior photo.
  const order = orderVenueReferenceIndexes("grand-venue", refs, [3, 4, 0, 2]);
  assert.deepEqual(order.slice(0, 4), [3, 2, 5, 1]);
  assert.deepEqual(order.slice(4), [4, 0], "then the rest of the ranking, then any remaining photo");
  assert.equal(new Set(order).size, refs.length);
  assert.deepEqual(orderVenueReferenceIndexes("grand-venue", [{}, {}], [7, -1, 1]), [1, 0], "out-of-range ranks ignored");
});

/* ---------------------------------------------------------- render loop */

test("a passing frame costs one render and one accepted render_attempts row", async () => {
  const { deps, attempts } = stubDeps();
  const result = await renderGalleryFrameWithQuality(
    { sessionId: 7, scene, style, sceneIndex: 0, coupleBuffers: [ref, ref], venueBuffers: [ref, ref, ref] },
    deps,
  );
  assert.equal(result.judgeStatus, "passed");
  assert.equal(result.attempts, 1);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]!.outcome, "accepted");
  assert.equal(attempts[0]!.inputTokens, 1000);
  assert.equal(attempts[0]!.outputTokens, 4000);
  assert.equal(attempts[0]!.latencyMs, 250);
  assert.equal(attempts[0]!.size, "1344x1792");
});

test("blocked content fails the scene after exactly one render attempt", async () => {
  let renders = 0;
  const { deps, attempts } = stubDeps({
    generateStill: async () => {
      renders += 1;
      throw new StillImageBlockedError("blocked", "gpt-image-2.5-sunburst");
    },
  });
  await assert.rejects(
    renderGalleryFrameWithQuality(
      { sessionId: 7, scene, style, sceneIndex: 0, coupleBuffers: [ref, ref], venueBuffers: [ref] },
      deps,
    ),
    StillImageBlockedError,
  );
  assert.equal(renders, 1);
  assert.deepEqual(
    attempts.map((a) => [a.outcome, a.errorClass]),
    [["blocked", "blocked"]],
  );
});

test("a judge outage never buys another render: the frame ships unjudged for owner review", async () => {
  let renders = 0;
  const { deps, attempts } = stubDeps({
    generateStill: async () => {
      renders += 1;
      return stillResult();
    },
    judgeFrame: async () => {
      throw new GalleryJudgeUnavailableError("judge 503 after retries", true);
    },
  });
  const result = await renderGalleryFrameWithQuality(
    { sessionId: 7, scene, style, sceneIndex: 0, coupleBuffers: [ref, ref], venueBuffers: [ref] },
    deps,
  );
  assert.equal(renders, 1);
  assert.equal(result.judgeStatus, "unjudged");
  assert.equal(result.qualityReport, null);
  assert.equal(attempts[0]!.errorClass, "judge_unavailable");
});

test("a frame the judge scores below target is re-rendered with targeted guidance; every attempt is logged", async () => {
  const prompts: string[] = [];
  let judged = 0;
  const { deps, attempts, fallbacks } = stubDeps({
    generateStill: async (params) => {
      prompts.push(params.prompt);
      return stillResult(prompts.length === 1 ? "gpt-image-2.5-sunburst" : "gpt-image-2.5-flare");
    },
    judgeFrame: async () => {
      judged += 1;
      if (judged === 1) throw qualityError(belowTargetReport);
      return goodReport;
    },
  });
  const result = await renderGalleryFrameWithQuality(
    { sessionId: 7, scene, style, sceneIndex: 0, coupleBuffers: [ref, ref], venueBuffers: [ref] },
    deps,
  );
  assert.equal(result.attempts, 2);
  assert.equal(result.model, "gpt-image-2.5-flare");
  assert.equal(result.fallbackUsed, true);
  assert.ok(prompts[1]!.includes("QUALITY RETRY CORRECTION"));
  assert.deepEqual(
    attempts.map((a) => [a.attempt, a.outcome, a.fallbackUsed]),
    [
      [1, "rejected", false],
      [2, "accepted", true],
    ],
  );
  assert.equal(fallbacks.length, 1, "a fallback-model render is audited");
});

test("provider timeouts are logged as timeouts and the best below-target frame still ships", async () => {
  let call = 0;
  const { deps, attempts } = stubDeps({
    generateStill: async () => {
      call += 1;
      if (call % 2 === 0) {
        throw new StillImageRequestError({
          message: "did not answer",
          status: 0,
          body: "",
          retryWithFallbackModel: true,
          timedOut: true,
          model: "gpt-image-2.5-flare",
        });
      }
      return stillResult();
    },
    judgeFrame: async () => {
      throw qualityError(belowTargetReport);
    },
  });
  const result = await renderGalleryFrameWithQuality(
    { sessionId: 7, scene, style, sceneIndex: 0, coupleBuffers: [ref, ref], venueBuffers: [ref] },
    deps,
  );
  assert.equal(result.judgeStatus, "below_target");
  assert.ok(attempts.some((a) => a.outcome === "timeout" && a.model === "gpt-image-2.5-flare"));
  assert.equal(attempts.length, 4, "GALLERY_FRAME_ATTEMPTS defaults to four render attempts");
});

test("the session deadline aborts the render loop without logging a bogus attempt", async () => {
  const controller = new AbortController();
  const { deps, attempts } = stubDeps({
    generateStill: async (params) => {
      controller.abort(new SessionDeadlineError(1000));
      params.signal?.throwIfAborted();
      return stillResult();
    },
  });
  await assert.rejects(
    renderGalleryFrameWithQuality(
      { sessionId: 7, scene, style, sceneIndex: 0, coupleBuffers: [ref, ref], venueBuffers: [ref], signal: controller.signal },
      deps,
    ),
    SessionDeadlineError,
  );
  assert.equal(attempts.length, 0);
});

/* ----------------------------------------------------------- semaphore */

test("the render semaphore caps concurrency and serves waiters in order", async () => {
  const slots = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const order: number[] = [];
  await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      slots.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(n);
        active -= 1;
      }),
    ),
  );
  assert.equal(peak, 2);
  assert.deepEqual(order, [1, 2, 3, 4, 5]);
  assert.equal(slots.inUse, 0);
});

/* --------------------------------------------------------- gallery run */

function memoryStore(initial: Array<{ objectKey: string; assetType: string; displayOrder: number }> = []) {
  const rows = [...initial];
  let readyCalls = 0;
  const holds: Array<string | null | undefined> = [];
  const store: GalleryStore = {
    listAssets: async () => rows.map((row) => ({ ...row })),
    insertAsset: async (row) => {
      rows.push({ objectKey: row.objectKey, assetType: row.assetType, displayOrder: row.displayOrder });
    },
    deleteAsset: async (_sessionId, assetType, displayOrder) => {
      const index = rows.findIndex((row) => row.assetType === assetType && row.displayOrder === displayOrder);
      if (index < 0) return null;
      return rows.splice(index, 1)[0]!.objectKey;
    },
    markReady: async (sessionId, options) => {
      readyCalls += 1;
      holds.push(options?.deliveryHoldReason);
      return { id: sessionId, status: "ready" } as CoupleSession;
    },
  };
  return { store, rows, holds, readyCalls: () => readyCalls };
}

function runDeps(store: GalleryStore, overrides: Partial<GalleryRunDeps> = {}) {
  const { deps, attempts } = stubDeps(overrides);
  const reelInputs: Buffer[][] = [];
  return {
    attempts,
    reelInputs,
    deps: {
      ...deps,
      store,
      polish: async (raw: Buffer) => Buffer.concat([Buffer.from("polished:"), raw]),
      buildReel: async (slides: Buffer[]) => {
        reelInputs.push(slides);
        return Buffer.from("reel");
      },
      slots: new Semaphore(4),
      ...overrides,
    } as GalleryRunDeps,
  };
}

const session = { id: 42, venueId: 3, kind: "couple" } as CoupleSession;

test("a failing scene keeps the other accepted frames stored and fails with the scene summary", async () => {
  const { store, rows, readyCalls } = memoryStore();
  let uploads = 0;
  const { deps } = runDeps(store, {
    generateStill: async (params) => {
      if (params.aspectRatio === "16:9") throw new StillImageBlockedError("blocked");
      return stillResult();
    },
  });
  await assert.rejects(
    processGallerySession(
      {
        session,
        style,
        coupleBuffers: [ref, ref],
        venueBuffers: [ref],
        uploadBuffer: async () => `/objects/uploads/frame-${++uploads}.jpg`,
      },
      deps,
    ),
    (err: unknown) => {
      assert.ok(err instanceof GallerySceneFailureError);
      assert.ok(err.primary instanceof StillImageBlockedError);
      assert.match(failureDetailFor(err), /3 kept for retry, 1 failed \(grand-venue\)/);
      return true;
    },
  );
  assert.equal(rows.filter((row) => row.assetType === "image").length, 3, "accepted frames are not deleted");
  assert.equal(readyCalls(), 0);
});

test("a retry renders only the missing scene, replaces any stale reel and marks the session ready", async () => {
  const { store, rows, holds } = memoryStore([
    { objectKey: "/objects/uploads/a.jpg", assetType: "image", displayOrder: 1 },
    { objectKey: "/objects/uploads/b.jpg", assetType: "image", displayOrder: 2 },
    { objectKey: "/objects/uploads/d.jpg", assetType: "image", displayOrder: 4 },
    { objectKey: "/objects/uploads/old-reel.mp4", assetType: "video", displayOrder: 0 },
  ]);
  const rendered: string[] = [];
  const deleted: string[] = [];
  const { deps, reelInputs } = runDeps(store, {
    generateStill: async (params) => {
      rendered.push(params.aspectRatio);
      return stillResult();
    },
    judgeFrame: async () => {
      throw new GalleryJudgeUnavailableError("down", true);
    },
  });
  const kept = new Map([
    [1, Buffer.from("kept-1")],
    [2, Buffer.from("kept-2")],
    [4, Buffer.from("kept-4")],
  ]);
  const result = await processGallerySession(
    {
      session,
      style,
      coupleBuffers: [ref, ref],
      venueBuffers: [ref],
      existingFrames: kept,
      uploadBuffer: async (_buffer, contentType) => (contentType === "video/mp4" ? "/objects/uploads/reel.mp4" : "/objects/uploads/c.jpg"),
      deleteObject: async (key) => {
        deleted.push(key);
      },
    },
    deps,
  );
  assert.deepEqual(rendered, ["16:9"], "only scene 3 (grand-venue) renders again");
  assert.ok(result.readySession);
  assert.equal(result.needsReview, true, "an unjudged frame holds the gallery for owner review");
  assert.deepEqual(holds, ["unjudged_frames"], "the hold is written with the ready transition, not after it");
  assert.deepEqual(deleted, ["/objects/uploads/old-reel.mp4"]);
  assert.equal(rows.filter((row) => row.assetType === "video").length, 1);
  assert.equal(reelInputs[0]![0]!.toString(), "kept-1", "the reel keeps scene order");
  assert.equal(reelInputs[0]!.length, 4);
});

test("a held gallery is never served through its share link until the owner releases it", async () => {
  const visibility = await import("./sessionVisibility.js");
  assert.equal(visibility.persistedDeliveryHold({ kind: "couple", reviewBeforeSend: true, needsReview: false }), "review_before_send");
  assert.equal(visibility.persistedDeliveryHold({ kind: "couple", reviewBeforeSend: false, needsReview: true }), "unjudged_frames");
  assert.equal(visibility.persistedDeliveryHold({ kind: "couple", reviewBeforeSend: false, needsReview: false }), null);
  assert.equal(visibility.persistedDeliveryHold({ kind: "sample", reviewBeforeSend: true, needsReview: true }), null);

  const complete = [
    { assetType: "video", displayOrder: 0 },
    ...[1, 2, 3, 4].map((displayOrder) => ({ assetType: "image", displayOrder })),
  ];
  assert.equal(visibility.canReadGeneratedAssetWithShareToken("ready", complete, null), true);
  assert.equal(visibility.canReadGeneratedAssetWithShareToken("ready", complete, "review_before_send"), false);
  assert.equal(visibility.canExposeGeneratedAssetsToSharePage("ready", "unjudged_frames"), false);
  assert.equal(visibility.canExposeGeneratedAssetsToSharePage("ready"), true);
});

/* ----------------------------------------------------------- deadline */

test("a session whose provider never answers is failed and refunded at the deadline and frees its slot", async () => {
  const failed: Array<{ id: number; err: unknown }> = [];
  let seenSignal: AbortSignal | null = null;
  const worker = createSessionWorker(
    {
      listPendingIds: async () => [11],
      processSession: (_id, { signal }) => {
        seenSignal = signal;
        return new Promise<void>(() => {}); // the provider never answers
      },
      failSession: async (id, err) => {
        failed.push({ id, err });
      },
      reapStale: async () => [],
      now: () => Date.now(),
    },
    { maxConcurrent: 1, deadlineMs: 40 },
  );
  const started = Date.now();
  await worker.runJob(11);
  assert.ok(Date.now() - started < 1000);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.id, 11);
  assert.ok(failed[0]!.err instanceof SessionDeadlineError);
  assert.equal(seenSignal!.aborted, true, "in-flight provider calls are aborted");
  assert.deepEqual(worker.stats(), { running: 0, inFlight: [] });
});

test("the reaper fails rows stuck past deadline + grace, skipping sessions still in flight", async () => {
  const reapCalls: Array<{ cutoff: Date; exclude: number[] }> = [];
  let now = 10_000_000;
  let release: () => void = () => {};
  const worker = createSessionWorker(
    {
      listPendingIds: async () => [5],
      processSession: () => new Promise<void>((resolve) => (release = resolve)),
      failSession: async () => {},
      reapStale: async (cutoff, exclude) => {
        reapCalls.push({ cutoff, exclude });
        return [];
      },
      now: () => now,
    },
    { maxConcurrent: 2, deadlineMs: 60_000, reapIntervalMs: 60_000 },
  );
  await worker.tick(); // reaps (nothing in flight yet), then starts session 5
  now += 1_000;
  await worker.tick(); // inside the reap interval: no second reap
  now += 60_000;
  await worker.tick();
  assert.equal(reapCalls.length, 2);
  assert.equal(reapCalls[1]!.cutoff.getTime(), now - 60_000 - REAPER_GRACE_MS);
  assert.deepEqual(reapCalls[1]!.exclude, [5]);
  release();
});

test("worker limits come from env with safe bounds", () => {
  assert.equal(sessionDeadlineMsFromEnv({}), 900_000);
  assert.equal(sessionDeadlineMsFromEnv({ SESSION_DEADLINE_MS: "1000" }), 60_000);
  assert.equal(sessionDeadlineMsFromEnv({ SESSION_DEADLINE_MS: "nope" }), 900_000);
  assert.equal(maxConcurrentSessionsFromEnv({}), 2);
  assert.equal(maxConcurrentSessionsFromEnv({ GALLERY_MAX_CONCURRENT: "50" }), 8);
});

/* ------------------------------------------------------------- failure */

function failDeps(overrides: Record<string, unknown> = {}) {
  const calls = { refunds: 0, funnel: [] as unknown[], forced: 0, marked: [] as unknown[] };
  const deps = {
    markFailed: async (_id: number, fields: unknown) => {
      calls.marked.push(fields);
      return { id: 42, kind: "couple", startedAt: new Date(Date.now() - 5_000) } as CoupleSession;
    },
    forceFailed: async () => {
      calls.forced += 1;
    },
    refund: async () => {
      calls.refunds += 1;
      return true;
    },
    venueOrganizationId: async () => 9,
    recordFunnelEvent: async (event: unknown) => {
      calls.funnel.push(event);
    },
    ...overrides,
  };
  return { deps, calls };
}

test("failSession stores couple-safe copy and raw owner detail, refunds once and logs session_failed", async () => {
  const { deps, calls } = failDeps();
  const transitioned = await failSession(
    { id: 42, venueId: 3, kind: "couple" },
    new Error("Storage upload failed with status 503: Service Unavailable at gcs://bucket"),
    deps,
  );
  assert.equal(transitioned, true);
  const fields = calls.marked[0] as { errorMessage: string; failureDetail: string };
  assert.ok(!fields.errorMessage.includes("gcs://"));
  assert.ok(fields.failureDetail.includes("gcs://bucket"));
  assert.equal(calls.refunds, 1);
  const event = calls.funnel[0] as { event: string; organizationId: number; properties: { durationMs: number } };
  assert.equal(event.event, "session_failed");
  assert.equal(event.organizationId, 9);
  assert.ok(event.properties.durationMs >= 5_000);
});

test("failSession is a no-op for funnel when another path already failed the session", async () => {
  const { deps, calls } = failDeps({ markFailed: async () => null });
  assert.equal(await failSession({ id: 42, venueId: 3 }, new SessionDeadlineError(1000), deps), false);
  assert.equal(calls.funnel.length, 0);
  assert.equal(calls.refunds, 1, "the refund itself is idempotent (credits_charged guard)");
});

test("refund guard only matches a failed session, so a gallery that turned ready keeps its charge", () => {
  const query = db
    .update(coupleSessionsTable)
    .set({ creditsCharged: 0 })
    .where(refundableSessionWhere(42, 1))
    .toSQL();
  assert.match(query.sql, /"status" = \$\d+/);
  assert.ok(query.params.includes("failed"));
  assert.ok(query.params.includes(42));
});

test("reconcileFailedRefunds retries refunds for failed sessions that still hold a charge", async () => {
  const attempted: number[] = [];
  const refunded = await reconcileFailedRefunds({
    listFailedCharged: async () => [7, 8, 9],
    refund: async (id) => {
      attempted.push(id);
      if (id === 8) throw new Error("connection reset");
      return id === 7;
    },
  });
  assert.deepEqual(attempted, [7, 8, 9]);
  assert.deepEqual(refunded, [7]);
});

test("failSession forces the failed status when the guarded update throws", async () => {
  const { deps, calls } = failDeps({
    markFailed: async () => {
      throw new Error("connection reset");
    },
  });
  await failSession({ id: 42, venueId: 3 }, new Error("boom"), deps);
  assert.equal(calls.forced, 1);
});

test("failed sample sessions never count in the funnel", async () => {
  const { deps, calls } = failDeps({
    markFailed: async () => ({ id: 42, kind: "sample" }) as CoupleSession,
  });
  await failSession({ id: 42, venueId: 3, kind: "sample" }, new Error("boom"), deps);
  assert.equal(calls.funnel.length, 0);
});

/* ------------------------------------------------------------ delivery */

const venue = {
  id: 3,
  name: "Willow & Stone",
  slug: "willow-stone",
  ownerEmail: "owner@example.com",
  organizationId: 9,
  reviewBeforeSend: false,
  bookingUrl: "https://willowstone.example/book",
  websiteUrl: null,
  contactEmail: null,
};
const readySession = {
  id: 42,
  venueId: 3,
  kind: "couple",
  createdVia: "couple_link",
  coupleEmail: "pat@example.com",
  coupleName: "Pat & Sam",
  weddingMonth: "2027-06",
  shareToken: "tok",
  startedAt: new Date(Date.now() - 60_000),
} as unknown as CoupleSession;
const generation = { readySession, scenes: [], needsReview: false, belowTargetFrames: 1, fallbackUsed: false };

function deliveryDeps(sendResult: { sent: true } | { sent: false; reason: string } = { sent: true }) {
  const log = { couple: [] as unknown[], review: 0, delivered: 0, gallery: [] as unknown[], funnel: [] as unknown[] };
  return {
    log,
    deps: {
      sendGalleryToCouple: async (email: string, _session: unknown, _venue: unknown, options: unknown) => {
        log.couple.push({ email, options });
        return sendResult;
      },
      notifyOwnerToReview: async () => {
        log.review += 1;
      },
      notifyOwnerDelivered: async () => {
        log.delivered += 1;
      },
      recordGalleryEvent: async (event: unknown) => {
        log.gallery.push(event);
      },
      recordFunnelEvent: async (event: unknown) => {
        log.funnel.push(event);
      },
    },
  };
}

test("a ready gallery is emailed to the couple with the venue's date CTA and logged as sent", async () => {
  const { deps, log } = deliveryDeps();
  const outcome = await deliverReadyGallery(readySession, venue, generation, deps);
  assert.deepEqual(outcome, { delivered: true, holdReason: null });
  const sent = log.couple[0] as { email: string; options: { venueName: string; bookingCta: { label: string; href: string } } };
  assert.equal(sent.email, "pat@example.com");
  assert.equal(sent.options.venueName, "Willow & Stone");
  assert.equal(sent.options.bookingCta.label, "Check your date at Willow & Stone");
  assert.match(sent.options.bookingCta.href, /wedding_month=2027-06/);
  assert.match(sent.options.bookingCta.href, /utm_medium=email/);
  assert.deepEqual(log.gallery, [{ sessionId: 42, venueId: 3, eventType: "sent", source: "system", meta: { auto: true } }]);
  assert.equal(log.delivered, 1);
  assert.equal(log.review, 0);
  const funnel = log.funnel[0] as { event: string; properties: { delivered: boolean; belowTargetFrames: number } };
  assert.equal(funnel.event, "session_ready");
  assert.equal(funnel.properties.delivered, true);
  assert.equal(funnel.properties.belowTargetFrames, 1);
});

test("review_before_send holds the gallery for the owner; nothing goes to the couple", async () => {
  const { deps, log } = deliveryDeps();
  const outcome = await deliverReadyGallery(readySession, { ...venue, reviewBeforeSend: true }, generation, deps);
  assert.deepEqual(outcome, { delivered: false, holdReason: "review_before_send" });
  assert.equal(log.couple.length, 0);
  assert.equal(log.gallery.length, 0);
  assert.equal(log.review, 1);
  assert.equal((log.funnel[0] as { event: string }).event, "session_ready");
});

test("a failed send falls back to the owner, and unjudged or sample galleries are never auto-sent", async () => {
  const failedSend = deliveryDeps({ sent: false, reason: "RESEND_API_KEY not set" });
  assert.deepEqual(await deliverReadyGallery(readySession, venue, generation, failedSend.deps), {
    delivered: false,
    holdReason: "email_not_sent",
  });
  assert.equal(failedSend.log.review, 1);
  assert.equal(failedSend.log.gallery.length, 0);

  assert.equal(deliveryHoldReason(readySession, venue, { needsReview: true }), "unjudged_frames");
  assert.equal(deliveryHoldReason({ ...readySession, coupleEmail: "not-an-email" }, venue, { needsReview: false }), "no_couple_email");

  const sample = deliveryDeps();
  const outcome = await deliverReadyGallery({ ...readySession, kind: "sample" } as CoupleSession, venue, generation, sample.deps);
  assert.deepEqual(outcome, { delivered: false, holdReason: "sample" });
  assert.deepEqual(
    [sample.log.couple.length, sample.log.review, sample.log.gallery.length, sample.log.funnel.length],
    [0, 0, 0, 0],
    "sample galleries email nobody and never count in the funnel",
  );
});

/* ------------------------------------------------------------ telemetry */

test("render cost uses configured per-image prices and counts only images the provider returned", () => {
  assert.equal(renderPriceEnvKey("gpt-image-2.5-sunburst"), "RENDER_PRICE_GPT_IMAGE_2_5_SUNBURST");
  const env = { RENDER_PRICE_GPT_IMAGE_2_5_SUNBURST: "0.25", RENDER_PRICE_GPT_IMAGE_2_5_FLARE: "0.1" };
  assert.equal(renderUnitPriceUsd("gpt-image-2.5-sunburst-2026-09-08", env), 0.25, "dated snapshots use the alias price");
  assert.equal(renderUnitPriceUsd("gemini-3-pro-image", env), null);

  const row = (sceneId: string, attempt: number, model: string, outcome: string, outputTokens: number | null = 4000) => ({
    sceneId,
    attempt,
    model,
    fallbackUsed: model !== "gpt-image-2.5-sunburst",
    inputTokens: 1000,
    outputTokens,
    latencyMs: 30_000,
    outcome,
  });
  const summary = summarizeRenderCost(
    [
      row("portrait-vertical", 1, "gpt-image-2.5-sunburst", "accepted"),
      row("intimate-moment", 1, "gpt-image-2.5-sunburst", "rejected"),
      row("intimate-moment", 2, "gpt-image-2.5-flare", "accepted"),
      row("grand-venue", 1, "gpt-image-2.5-sunburst", "timeout", null),
      row("grand-venue", 2, "gemini-3-pro-image", "accepted"),
    ],
    env,
  );
  assert.equal(summary.attempts, 5);
  assert.equal(summary.billableImages, 4);
  assert.equal(summary.acceptedFrames, 3);
  assert.equal(summary.firstPassScenes, 1);
  assert.equal(summary.fallbackAttempts, 2);
  assert.equal(summary.failedAttempts, 1);
  assert.equal(summary.costUsd, 0.6);
  assert.equal(summary.costComplete, false);
  assert.deepEqual(summary.unpricedModels, ["gemini-3-pro-image"]);
  assert.equal(summarizeRenderCost([row("a", 1, "gpt-image-2.5-sunburst", "accepted")], {}).costUsd, null, "no price, no invented cost");
});

/* ---------------------------------------------------------------- reel */

test("a 3:4 still is letterboxed into the 16:9 reel frame, fully visible at the deepest zoom", async () => {
  const portrait = await sharp({ create: { width: 1344, height: 1792, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg()
    .toBuffer();
  const frame = await composeReelFrame(portrait);
  const meta = await sharp(frame.buffer).metadata();
  assert.equal(frame.letterboxed, true);
  assert.deepEqual([meta.width, meta.height], [2560, 1440], "2x supersampled 1280x720");
  // The still is centred and shorter than the zoomed viewport (1440 / 1.1).
  const { data } = await sharp(frame.buffer).extract({ left: 1280, top: 80, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0]! > 150, "the top band inside the zoom window still shows the photo");

  const wide = await sharp({ create: { width: 2048, height: 1152, channels: 3, background: { r: 10, g: 10, b: 10 } } }).jpeg().toBuffer();
  assert.equal((await composeReelFrame(wide)).letterboxed, false, "16:9 stills fill the frame");

  const filter = kenBurnsFilter(120, true);
  assert.ok(filter.startsWith("scale=2560:1440,setsar=1,zoompan="));
  assert.ok(filter.includes("z='1+0.100*on/119'"));
  assert.ok(filter.includes("s=1280x720"));
  assert.ok(!filter.includes("crop="), "no crop to 16:9");
});

test("the title card letters the venue name as paths, with no font dependency", async () => {
  assert.equal(strokeTextFor("Château Élysée & Co."), "CHATEAU ELYSEE & CO.");
  assert.equal(strokeTextFor("Willow <Estate>"), "WILLOW ESTATE");
  const long = layoutVenueTitle(strokeTextFor("The Grand Ballroom at Chateau Elysee and Gardens of the Hudson Valley"));
  assert.equal(long.lines.length, 2);
  const card = await buildReelTitleCard({ venueName: "Willow & Stone" });
  const meta = await sharp(card!).metadata();
  assert.deepEqual([meta.width, meta.height], [1280, 720]);
  const doubled = await sharp((await buildReelTitleCard({ venueName: "Willow & Stone" }, 2))!).metadata();
  assert.deepEqual([doubled.width, doubled.height], [2560, 1440]);
  assert.equal(await buildReelTitleCard({ venueName: "  " }), null);
});
