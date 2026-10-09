/**
 * Plan vocabulary for venue-facing surfaces. Prices and trial terms come
 * from the public config (lib/publicConfig.ts: meta tag, then
 * GET /public/config, then the launch defaults); nothing here hardcodes a
 * price.
 */

/** "payg" reads "Pay as you go"; internal ids never reach the owner. */
export function planLabel(plan: string | null | undefined): string {
  switch (plan) {
    case "starter":
      return "Starter";
    case "growth":
      return "Growth";
    case "payg":
      return "Pay as you go";
    case "trial":
      return "Free trial";
    case "none":
      return "No plan";
    default:
      return "Free trial";
  }
}

export function isSubscriptionPlan(plan: string | null | undefined): plan is "starter" | "growth" {
  return plan === "starter" || plan === "growth";
}

/** Cost of one gallery on a plan, in currency units, one decimal (129/25 is 5.2). */
export function perGalleryCost(monthly: number, credits: number): number {
  if (credits <= 0) return 0;
  return Math.round((monthly / credits) * 10) / 10;
}
