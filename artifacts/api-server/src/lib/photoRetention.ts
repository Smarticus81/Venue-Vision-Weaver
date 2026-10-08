import { logger } from "./logger.js";
import { readRetentionDays } from "./publicConfig.js";

/*
 * Couple source-photo retention sweep. Step-0 stub: the sessions workstream
 * (WS-C) fills in the sweep that deletes couple_media objects
 * COUPLE_PHOTO_RETENTION_DAYS after delivery and stamps
 * couple_sessions.source_photos_deleted_at. Until then this only logs the
 * configured window so the boot sequence and the env contract are in place.
 */

let started = false;

export function startPhotoRetentionSweep(): void {
  if (started) return;
  started = true;
  logger.info(
    { retentionDays: readRetentionDays() },
    "Photo retention sweep registered (no-op until the sessions workstream lands)",
  );
}
