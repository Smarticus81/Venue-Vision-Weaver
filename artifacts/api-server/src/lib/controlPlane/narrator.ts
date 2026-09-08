import type { AgentOutput, BusinessSnapshot } from "@workspace/control-plane";
import { logger } from "../logger.js";

/**
 * Optional narration. The fleet's decisions are produced deterministically —
 * the model never chooses an action — but a short written read of the numbers
 * makes the console far easier to scan. When no key is configured (or the
 * call fails) the deterministic summary stands on its own.
 */

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";
const NARRATOR_MODEL = process.env.CONTROL_PLANE_NARRATOR_MODEL ?? "gemini-2.5-flash";
const NARRATOR_TIMEOUT_MS = Number(process.env.CONTROL_PLANE_NARRATOR_TIMEOUT_MS ?? "12000");

function apiKey(): string | null {
  return process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || null;
}

export function narrationEnabled(): boolean {
  return apiKey() !== null && process.env.CONTROL_PLANE_NARRATION !== "off";
}

interface GeminiTextResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

/**
 * A few sentences an operator can read instead of the observation table.
 * Returns null rather than throwing: narration is never load-bearing.
 */
export async function narrateRun(
  agentKey: string,
  charter: string,
  output: AgentOutput,
  snapshot: BusinessSnapshot,
): Promise<string | null> {
  const key = apiKey();
  if (!key || !narrationEnabled()) return null;

  const prompt =
    `You are the ${agentKey} in an autonomous operating system running a small wedding-venue SaaS.\n` +
    `Your charter: ${charter}\n\n` +
    `These are the measurements you just took:\n` +
    output.observations
      .map(
        (observation) =>
          `- ${observation.label}: ${observation.value ?? "n/a"}` +
          (observation.detail ? ` (${observation.detail})` : "") +
          (observation.severity && observation.severity !== "info" ? ` [${observation.severity}]` : ""),
      )
      .join("\n") +
    `\n\nDecisions you are proposing:\n` +
    (output.proposals.length
      ? output.proposals.map((proposal) => `- ${proposal.title}`).join("\n")
      : "- none") +
    `\n\nBusiness context: ${snapshot.venues.length} venues, ` +
    `${snapshot.funnel.last7d.started} gallery starts in the last 7 days, ` +
    `${snapshot.finance.creditsBalance} credits remaining.\n\n` +
    `Write two or three sentences for the operator: what the numbers say, what you are doing about it, ` +
    `and what you need from them. No preamble, no bullet points, no headings. Do not invent numbers that ` +
    `are not above.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NARRATOR_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${NARRATOR_MODEL}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      logger.warn({ agentKey, status: response.status }, "Control plane narration request failed");
      return null;
    }
    const data = (await response.json()) as GeminiTextResponse;
    if (data.error) {
      logger.warn({ agentKey, error: data.error.message }, "Control plane narration returned an error");
      return null;
    }
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    return text ? text.slice(0, 1200) : null;
  } catch (err) {
    logger.warn({ err, agentKey }, "Control plane narration threw");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
