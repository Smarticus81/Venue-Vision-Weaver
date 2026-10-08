/**
 * Plan constants shared by the organizations and venues schema modules.
 * Kept in their own file so organizations.ts and venues.ts can reference each
 * other's tables without a circular import.
 */

/** Credits granted once per organization on signup (no card). */
export const TRIAL_CREDITS = 5;
export const STARTER_MONTHLY_CREDITS = 25;
export const GROWTH_MONTHLY_CREDITS = 100;
export const CREDIT_PACK_AMOUNT = 10;
