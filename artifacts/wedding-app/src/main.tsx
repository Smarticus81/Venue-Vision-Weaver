import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { clearLegacySavedSessions } from "./lib/savedSessions";
import {
  CLERK_PUBLISHABLE_KEY,
  clerkExpectedDomain,
  clerkStatus,
  darkroomAppearance,
} from "./lib/clerk";

clearLegacySavedSessions();

const root = createRoot(document.getElementById("root")!);

if (CLERK_PUBLISHABLE_KEY) {
  root.render(
    <AppErrorBoundary>
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
        appearance={darkroomAppearance}
        afterSignOutUrl="/"
      >
        <App />
      </ClerkProvider>
    </AppErrorBoundary>,
  );
} else {
  // Couple-facing routes work without Clerk; owner routes show a setup notice
  // explaining exactly what is wrong (missing key, malformed key, or a
  // production key served from the wrong domain).
  if (clerkStatus === "missing") {
    console.warn("VITE_CLERK_PUBLISHABLE_KEY is not set — owner sign-in is disabled.");
  } else if (clerkStatus === "invalid-key") {
    console.error(
      "The Clerk publishable key is malformed (expected pk_test_… or pk_live_…) — owner sign-in is disabled.",
    );
  } else if (clerkStatus === "domain-mismatch") {
    console.error(
      `The Clerk production key is locked to "${clerkExpectedDomain}" but this page is served from ` +
        `"${window.location.hostname}". Open the site at https://${clerkExpectedDomain} or use a ` +
        "development (pk_test_…) key for this environment.",
    );
  }
  root.render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>,
  );
}
