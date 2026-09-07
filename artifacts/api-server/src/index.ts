import "./loadEnv.js";
import app from "./app";
import { logger } from "./lib/logger";
import {
  db,
  coupleSessionsTable,
  generatedAssetsTable,
  ownerLoginTokensTable,
  ownerSessionsTable,
  uploadIntentsTable,
} from "@workspace/db";
import { and, asc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { refundCreditsForSession } from "./lib/credits.js";
import { startSessionWorker } from "./lib/sessionWorker.js";
import { getAppBaseUrl } from "./lib/appUrl.js";
import { assertProductionEnvironment } from "./lib/envValidation.js";
import {
  ownerAuthCleanupBatchSize,
  staleProcessingSessionMinutes,
  uploadIntentCleanupBatchSize,
} from "./lib/sessionCleanupConfig.js";
import { ObjectStorageService } from "./lib/objectStorage.js";

const objectStorageService = new ObjectStorageService();

async function cleanupGeneratedAssetsForSession(sessionId: number): Promise<void> {
  const assets = await db
    .select({ objectKey: generatedAssetsTable.objectKey })
    .from(generatedAssetsTable)
    .where(eq(generatedAssetsTable.sessionId, sessionId));

  await db.delete(generatedAssetsTable).where(eq(generatedAssetsTable.sessionId, sessionId));

  for (const asset of assets) {
    try {
      await objectStorageService.deleteObjectEntity(asset.objectKey);
    } catch (err) {
      logger.warn(
        { err, sessionId, objectKey: asset.objectKey },
        "Failed to delete partial generated asset during startup recovery",
      );
    }
  }
}

async function cleanupOrphanedSessions(): Promise<void> {
  const staleMinutes = staleProcessingSessionMinutes();
  try {
    const result = await db
      .update(coupleSessionsTable)
      .set({
        status: "failed",
        errorMessage: "Server was restarted during generation. Please try again.",
        completedAt: new Date(),
      })
      .where(
        and(
          eq(coupleSessionsTable.status, "processing"),
          lt(coupleSessionsTable.createdAt, sql`NOW() - (${staleMinutes} * INTERVAL '1 minute')`),
        ),
      )
      .returning({ id: coupleSessionsTable.id });

    if (result.length > 0) {
      for (const row of result) {
        await cleanupGeneratedAssetsForSession(row.id);
        await refundCreditsForSession(row.id);
      }
      logger.warn(
        { count: result.length, ids: result.map((r) => r.id), staleMinutes },
        "Marked orphaned in-flight sessions as failed on startup",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to cleanup orphaned sessions on startup");
  }
}

async function cleanupExpiredUploadIntents(): Promise<void> {
  const batchSize = uploadIntentCleanupBatchSize();
  try {
    const expired = await db
      .select({
        id: uploadIntentsTable.id,
        objectKey: uploadIntentsTable.objectKey,
      })
      .from(uploadIntentsTable)
      .where(and(isNull(uploadIntentsTable.consumedAt), lt(uploadIntentsTable.expiresAt, new Date())))
      .orderBy(asc(uploadIntentsTable.expiresAt))
      .limit(batchSize);

    let deleted = 0;
    for (const intent of expired) {
      try {
        await objectStorageService.deleteObjectEntity(intent.objectKey);
        await db
          .delete(uploadIntentsTable)
          .where(and(eq(uploadIntentsTable.id, intent.id), isNull(uploadIntentsTable.consumedAt)));
        deleted += 1;
      } catch (deleteErr) {
        logger.warn(
          { err: deleteErr, intentId: intent.id, objectKey: intent.objectKey },
          "Failed to cleanup expired upload intent",
        );
      }
    }

    if (deleted > 0) {
      logger.info({ count: deleted, batchSize }, "Cleaned up expired unconsumed upload intents");
    }
  } catch (err) {
    logger.error({ err }, "Failed to cleanup expired upload intents on startup");
  }
}

async function cleanupExpiredOwnerAuth(): Promise<void> {
  const batchSize = ownerAuthCleanupBatchSize();
  try {
    const expiredTokens = await db
      .select({ id: ownerLoginTokensTable.id })
      .from(ownerLoginTokensTable)
      .where(or(lt(ownerLoginTokensTable.expiresAt, new Date()), isNotNull(ownerLoginTokensTable.usedAt)))
      .orderBy(asc(ownerLoginTokensTable.expiresAt))
      .limit(batchSize);

    const expiredSessions = await db
      .select({ id: ownerSessionsTable.id })
      .from(ownerSessionsTable)
      .where(or(lt(ownerSessionsTable.expiresAt, new Date()), eq(ownerSessionsTable.revoked, true)))
      .orderBy(asc(ownerSessionsTable.expiresAt))
      .limit(batchSize);

    let deletedTokens = 0;
    for (const token of expiredTokens) {
      const rows = await db
        .delete(ownerLoginTokensTable)
        .where(eq(ownerLoginTokensTable.id, token.id))
        .returning({ id: ownerLoginTokensTable.id });
      deletedTokens += rows.length;
    }

    let deletedSessions = 0;
    for (const session of expiredSessions) {
      const rows = await db
        .delete(ownerSessionsTable)
        .where(eq(ownerSessionsTable.id, session.id))
        .returning({ id: ownerSessionsTable.id });
      deletedSessions += rows.length;
    }

    if (deletedTokens > 0 || deletedSessions > 0) {
      logger.info(
        { deletedTokens, deletedSessions, batchSize },
        "Cleaned up expired owner auth rows",
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to cleanup expired owner auth rows on startup");
  }
}

// A stray rejected promise (background poller, webhook side effect, …) must
// not take the whole site down; log it and keep serving.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

const rawPort = process.env["PORT"];

assertProductionEnvironment();

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, appBaseUrl: getAppBaseUrl() }, "Server listening");
  void cleanupOrphanedSessions();
  void cleanupExpiredUploadIntents();
  void cleanupExpiredOwnerAuth();
  startSessionWorker();
});
