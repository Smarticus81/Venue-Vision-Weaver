import {
  db,
  coupleSessionsTable,
  generatedAssetsTable,
  venuesTable,
  type CoupleSession,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { polishGalleryFrame } from "./galleryFrame.js";
import { generateCinematicStillWithMetadata } from "./stillImageClient.js";
import { buildKenBurnsSlideshow } from "./motionReel.js";
import type { GalleryStyle } from "./galleryStyles.js";
import {
  buildSceneKontextPrompt,
  planGalleryScenes,
  type WeddingScene,
} from "./scenePlan.js";
import { rankVenueReferencesForScene } from "./venueReferenceSelector.js";
import { sendGalleryReadyNotification } from "./emailService.js";
import {
  assertGalleryFrameQuality,
  qualityRetryGuidanceForError,
  type GalleryQualityReport,
} from "./galleryQuality.js";
import { hasCompletePublicGalleryAssets } from "./sessionVisibility.js";
import { logger } from "./logger.js";
import {
  preferredVenueCoveragesForScene,
  type VenueMediaCoverage,
} from "./venueMediaCoverage.js";

export interface GalleryGenerationContext {
  session: CoupleSession;
  style: GalleryStyle;
  coupleBuffers: { buffer: Buffer; mimeType: string }[];
  venueBuffers: { buffer: Buffer; mimeType: string }[];
  uploadBuffer: (buffer: Buffer, contentType: string) => Promise<string>;
}

const FRAME_ATTEMPTS = Math.max(
  1,
  Math.min(5, Number(process.env.GALLERY_FRAME_ATTEMPTS ?? "4")),
);
const MAX_TOTAL_REFERENCE_IMAGES = 14;
const MAX_COUPLE_REFERENCES = 3;

type ImageRef = { buffer: Buffer; mimeType: string; coverage?: VenueMediaCoverage | null };

export interface GalleryFrameRenderResult {
  raw: Buffer;
  qualityReport: GalleryQualityReport | null;
  venueReferenceIndexes: number[];
  attempts: number;
  model: string;
}

export function venueReferenceIndexesForScene(sceneId: string): number[] {
  switch (sceneId) {
    case "portrait-vertical":
      return [1, 3, 0];
    case "intimate-moment":
      return [3, 1, 0];
    case "grand-venue":
      return [0, 1, 4];
    case "celebration":
      return [4, 0, 3];
    default:
      return [0, 1, 2];
  }
}

async function selectVenueReferences(scene: WeddingScene, venueBuffers: ImageRef[]): Promise<{
  sceneVenueRef: ImageRef;
  venueRefs: ImageRef[];
  venueReferenceIndexes: number[];
}> {
  const rankedIndexes = await rankVenueReferencesForScene(scene, venueBuffers);
  const coverageIndexes = preferredVenueCoveragesForScene(scene.id).flatMap((coverage) =>
    venueBuffers.flatMap((ref, index) => (ref.coverage === coverage ? [index] : [])),
  );
  const indexes = [
    ...coverageIndexes,
    ...rankedIndexes,
    0,
    ...venueReferenceIndexesForScene(scene.id),
    ...venueBuffers.map((_, index) => index),
  ];

  const ordered: ImageRef[] = [];
  const venueReferenceIndexes: number[] = [];
  const maxVenueReferences = Math.max(1, MAX_TOTAL_REFERENCE_IMAGES - MAX_COUPLE_REFERENCES);
  for (const index of indexes) {
    if (ordered.length >= maxVenueReferences) break;
    const ref = venueBuffers[index];
    if (ref && !ordered.includes(ref)) {
      ordered.push(ref);
      venueReferenceIndexes.push(index);
    }
  }
  return {
    sceneVenueRef: ordered[0] ?? venueBuffers[0]!,
    venueRefs: ordered.slice(0, maxVenueReferences),
    venueReferenceIndexes: venueReferenceIndexes.slice(0, maxVenueReferences),
  };
}

export async function renderGalleryFrameWithQuality(ctx: {
  sessionId: number;
  scene: WeddingScene;
  style: GalleryStyle;
  sceneIndex: number;
  coupleBuffers: ImageRef[];
  venueBuffers: ImageRef[];
}): Promise<GalleryFrameRenderResult> {
  const { sessionId, scene, style, sceneIndex, coupleBuffers, venueBuffers } = ctx;
  const { sceneVenueRef, venueRefs, venueReferenceIndexes } = await selectVenueReferences(
    scene,
    venueBuffers,
  );

  let lastErr: unknown = null;
  let retryGuidance: string | null = null;
  for (let attempt = 1; attempt <= FRAME_ATTEMPTS; attempt++) {
    try {
      const basePrompt = buildSceneKontextPrompt(scene, style);
      const generated = await generateCinematicStillWithMetadata({
        prompt: retryGuidance ? `${basePrompt}\n\n${retryGuidance}` : basePrompt,
        coupleReference: coupleBuffers[0]!,
        coupleReferences: coupleBuffers.slice(0, MAX_COUPLE_REFERENCES),
        venueReference: sceneVenueRef,
        venueReferences: venueRefs,
        aspectRatio: scene.aspectRatio,
      });
      const qualityReport = await assertGalleryFrameQuality({
        sessionId,
        scene,
        generated: { buffer: generated.buffer, mimeType: "image/jpeg" },
        coupleReferences: coupleBuffers.slice(0, MAX_COUPLE_REFERENCES),
        venueReferences: venueRefs,
      });
      return {
        raw: generated.buffer,
        qualityReport,
        venueReferenceIndexes,
        attempts: attempt,
        model: generated.model,
      };
    } catch (err) {
      lastErr = err;
      const nextGuidance = qualityRetryGuidanceForError(err);
      if (nextGuidance) retryGuidance = nextGuidance;
      logger.warn(
        {
          err,
          sessionId,
          sceneId: scene.id,
          sceneIndex,
          attempt,
          maxAttempts: FRAME_ATTEMPTS,
          venueRefCount: venueRefs.length,
          adaptiveRetry: Boolean(nextGuidance),
        },
        "Gallery frame attempt failed",
      );
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gallery frame generation failed");
}

export async function processGallerySession(ctx: GalleryGenerationContext): Promise<void> {
  const { session, style, coupleBuffers, venueBuffers, uploadBuffer } = ctx;
  const sessionId = session.id;
  const scenes = planGalleryScenes();

  const polishedSlides: Buffer[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    logger.info(
      {
        sessionId,
        sceneId: scene.id,
        sceneTitle: scene.title,
        sceneIndex: i + 1,
        sceneTotal: scenes.length,
        aspectRatio: scene.aspectRatio,
      },
      "Rendering glimpse gallery still",
    );

    const result = await renderGalleryFrameWithQuality({
      sessionId,
      scene,
      style,
      sceneIndex: i,
      coupleBuffers,
      venueBuffers,
    });
    logger.info(
      {
        sessionId,
        sceneId: scene.id,
        model: result.model,
        attempts: result.attempts,
      },
      "Gallery frame rendered with image model",
    );

    const polished = await polishGalleryFrame(result.raw, {
      coupleName: session.coupleName,
      sceneIndex: i,
    });
    polishedSlides.push(polished);

    const imageKey = await uploadBuffer(polished, "image/jpeg");
    await db.insert(generatedAssetsTable).values({
      sessionId,
      objectKey: imageKey,
      assetType: "image",
      displayOrder: i + 1,
      generationModel: result.model,
      generationAttempts: result.attempts,
      venueReferenceIndexes: result.venueReferenceIndexes,
      qualityReport: result.qualityReport as unknown as Record<string, unknown> | null,
    });
  }

  const [venue] = await db
    .select()
    .from(venuesTable)
    .where(eq(venuesTable.id, session.venueId));

  logger.info({ sessionId, venueName: venue?.name }, "Building Ken Burns motion reel from gallery stills");
  const reelBuffer = await buildKenBurnsSlideshow(polishedSlides, 4, {
    venueName: venue?.name,
  });
  const reelKey = await uploadBuffer(reelBuffer, "video/mp4");
  await db.insert(generatedAssetsTable).values({
    sessionId,
    objectKey: reelKey,
    assetType: "video",
    displayOrder: 0,
  });

  const publicAssets = await db
    .select({
      assetType: generatedAssetsTable.assetType,
      displayOrder: generatedAssetsTable.displayOrder,
    })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId));

  if (!hasCompletePublicGalleryAssets(publicAssets)) {
    throw new Error(
      "Generated gallery is incomplete; refusing to mark session ready until four stills and one motion reel exist.",
    );
  }

  await db
    .update(coupleSessionsTable)
    .set({ status: "ready", completedAt: new Date() })
    .where(eq(coupleSessionsTable.id, sessionId));

  const [updatedSession] = await db
    .select()
    .from(coupleSessionsTable)
    .where(eq(coupleSessionsTable.id, sessionId));

  // Notify the venue owner only. The gallery is never auto-sent to the couple;
  // the owner reviews it first and sends it from the dashboard.
  if (updatedSession && venue) {
    void sendGalleryReadyNotification(venue.ownerEmail, updatedSession, venue);
  }

  logger.info(
    { sessionId, stillCount: polishedSlides.length },
    "Gallery generation complete",
  );
}

export { userMessageForStillError } from "./stillImageClient.js";
