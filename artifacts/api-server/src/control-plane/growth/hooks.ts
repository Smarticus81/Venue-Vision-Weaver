import { logger } from "../../lib/logger.js";
import { attributeSignups } from "./attribution.js";
import { growthLoopEnabled } from "./config.js";

/**
 * Server-side growth hooks called from outside the control plane. Callers
 * always fire-and-forget with a catch, so a hook failure never breaks the
 * request that triggered it.
 */

/** Called after a venue is created for an organization (routes/venues.ts): attribute the signup to a prospect right away. */
export async function onVenueCreated(organizationId: number): Promise<void> {
  if (!growthLoopEnabled()) return;
  const converted = await attributeSignups({ organizationId });
  if (converted > 0) {
    logger.info({ organizationId, converted }, "Venue creation attributed to outreach prospect(s)");
  }
}
