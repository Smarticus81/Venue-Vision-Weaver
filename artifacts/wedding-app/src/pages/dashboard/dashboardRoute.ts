import type { DashboardTab } from "./types";

/**
 * Pure parsing of the dashboard URL. The shell syncs the open tab to the
 * hash (#billing, #pricing → billing) and reads the one-shot query flags
 * the signup page and Stripe append (?welcome=1&import=1, ?billing=success).
 */

export const DASHBOARD_TABS: ReadonlyArray<{ id: DashboardTab; label: string }> = [
  { id: "galleries", label: "Couple galleries" },
  { id: "new", label: "Create a gallery" },
  { id: "photos", label: "Venue photos" },
  { id: "settings", label: "Settings" },
  { id: "billing", label: "Plan & credits" },
];

const HASH_ALIASES: Record<string, DashboardTab> = {
  pricing: "billing",
  plan: "billing",
  credits: "billing",
  upgrade: "billing",
  gallery: "galleries",
  create: "new",
  venue: "settings",
};

export function isDashboardTab(value: string): value is DashboardTab {
  return DASHBOARD_TABS.some((tab) => tab.id === value);
}

export function tabFromHash(hash: string): DashboardTab | null {
  const raw = hash.replace(/^#/, "").trim().toLowerCase();
  if (!raw) return null;
  if (isDashboardTab(raw)) return raw;
  return HASH_ALIASES[raw] ?? null;
}

export interface DashboardLocation {
  tab: DashboardTab | null;
  welcome: boolean;
  importRequested: boolean;
  billing: "success" | "cancel" | null;
}

export function parseDashboardLocation(search: string, hash: string): DashboardLocation {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const billingRaw = params.get("billing");
  const billing = billingRaw === "success" || billingRaw === "cancel" ? billingRaw : null;
  const welcome = params.get("welcome") === "1";
  const importRequested = params.get("import") === "1";
  const tab = tabFromHash(hash) ?? (billing ? "billing" : welcome ? "photos" : null);
  return { tab, welcome, importRequested, billing };
}

/** Strips the one-shot flags so a reload does not replay them. */
export function cleanedSearch(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of ["billing", "welcome", "import"]) params.delete(key);
  const out = params.toString();
  return out ? `?${out}` : "";
}
