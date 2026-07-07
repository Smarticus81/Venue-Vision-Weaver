import type { Appearance } from "@clerk/types";

// The server injects the key into index.html at request time (see the
// api-server's serveIndexHtml), so a bundle built without
// VITE_CLERK_PUBLISHABLE_KEY still picks it up from the deployment
// environment. The runtime value wins so a rotated key needs no rebuild.
const runtimeKey =
  typeof document !== "undefined"
    ? document
        .querySelector('meta[name="clerk-publishable-key"]')
        ?.getAttribute("content")
        ?.trim()
    : undefined;

export const CLERK_PUBLISHABLE_KEY =
  runtimeKey ||
  (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim() ||
  null;

export const clerkConfigured = Boolean(CLERK_PUBLISHABLE_KEY);

/**
 * Clerk components themed to the editorial-darkroom system: near-black
 * surfaces, porcelain type, candlelight-rose accent, sharp corners.
 */
export const darkroomAppearance: Appearance = {
  variables: {
    colorBackground: "hsl(24 8% 9%)",
    colorInputBackground: "hsl(20 9% 6%)",
    colorText: "hsl(40 23% 92%)",
    colorInputText: "hsl(40 23% 92%)",
    colorTextSecondary: "hsl(33 9% 64%)",
    colorPrimary: "hsl(355 58% 71%)",
    colorTextOnPrimaryBackground: "hsl(20 10% 8%)",
    colorDanger: "hsl(0 62% 54%)",
    colorSuccess: "hsl(152 55% 52%)",
    colorNeutral: "hsl(40 23% 92%)",
    borderRadius: "0.25rem",
    fontFamily: "'Instrument Sans', system-ui, sans-serif",
  },
  elements: {
    card: "border border-[hsl(26_8%_16%)] shadow-none",
    headerTitle: "font-display",
    formButtonPrimary:
      "bg-[hsl(355_58%_71%)] text-[hsl(20_10%_8%)] hover:bg-[hsl(355_50%_64%)] text-sm normal-case",
  },
};
