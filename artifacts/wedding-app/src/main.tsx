import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { clearLegacySavedSessions } from "./lib/savedSessions";

clearLegacySavedSessions();

createRoot(document.getElementById("root")!).render(<App />);
