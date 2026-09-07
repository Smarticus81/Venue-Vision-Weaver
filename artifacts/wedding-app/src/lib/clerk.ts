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

/** Shared light theme for hosted authentication components. */
export const gardenAppearance: Appearance = {
  variables: {
    colorBackground: "#ffffff",
    colorInputBackground: "#fafaf6",
    colorText: "#24332b",
    colorInputText: "#24332b",
    colorTextSecondary: "#5f6d63",
    colorPrimary: "#326047",
    colorTextOnPrimaryBackground: "#ffffff",
    colorDanger: "#a62b26",
    colorSuccess: "#326047",
    colorNeutral: "#24332b",
    borderRadius: "0.5rem",
    fontFamily: "'DM Sans', sans-serif",
  },
  elements: {
    card: "border border-border shadow-none",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-brand-hover text-sm normal-case",
  },
};
