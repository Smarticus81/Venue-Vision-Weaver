import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import App from "./App";
import "./index.css";
import { clearLegacySavedSessions } from "./lib/savedSessions";
import { CLERK_PUBLISHABLE_KEY, darkroomAppearance } from "./lib/clerk";

clearLegacySavedSessions();

const root = createRoot(document.getElementById("root")!);

if (CLERK_PUBLISHABLE_KEY) {
  root.render(
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      appearance={darkroomAppearance}
      afterSignOutUrl="/"
    >
      <App />
    </ClerkProvider>,
  );
} else {
  // Couple-facing routes work without Clerk; owner routes show a setup notice.
  console.warn("VITE_CLERK_PUBLISHABLE_KEY is not set — owner sign-in is disabled.");
  root.render(<App />);
}
