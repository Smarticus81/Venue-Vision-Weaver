// Synthetic moving test pattern, never a marketing/output-quality example.
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const output = new URL("../../../qa-output/mobile-reel.mp4", import.meta.url);
mkdirSync(new URL("../../../qa-output/", import.meta.url), { recursive: true });
execFileSync("ffmpeg", [
  "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24", "-t", "6",
  "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", fileURLToPath(output),
], { stdio: "inherit", windowsHide: true });
