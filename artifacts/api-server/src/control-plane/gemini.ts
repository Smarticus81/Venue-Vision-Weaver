import { logger } from "../lib/logger.js";

/**
 * Gemini function-calling loop over the raw v1beta REST surface (same
 * transport as the gallery pipeline; no SDK). The model reasons about the
 * live business context and acts exclusively through declared tools.
 */

const GEMINI_API_BASE =
  process.env.GEMINI_API_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta";

export function controlPlaneModel(): string {
  return process.env.CONTROL_PLANE_MODEL ?? process.env.GEMINI_QUALITY_MODEL ?? "gemini-2.5-pro";
}

export function controlPlaneAiConfigured(): boolean {
  return Boolean(process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: { role?: string; parts?: GeminiPart[] } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; code?: number; status?: string };
}

export type TranscriptStep =
  | { type: "text"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: unknown; error?: string };

export interface AgentLoopResult {
  finalText: string;
  transcript: TranscriptStep[];
  toolCallCount: number;
  promptTokens: number;
  completionTokens: number;
}

const MAX_ITERATIONS = 10;
const MAX_TOOL_CALLS = 24;
const MAX_TOOL_RESULT_CHARS = 24000;

function truncateForModel(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return value;
  return {
    truncated: true,
    preview: json.slice(0, MAX_TOOL_RESULT_CHARS),
    originalLength: json.length,
  };
}

async function callGemini(
  model: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<GeminiResponse> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini request failed (${res.status}): ${text.slice(0, 600)}`);
  }
  const json = JSON.parse(text) as GeminiResponse;
  if (json.error) {
    throw new Error(`Gemini error: ${json.error.message ?? "unknown"}`);
  }
  return json;
}

export async function runAgentLoop(params: {
  systemPrompt: string;
  userMessage: string;
  tools: GeminiFunctionDeclaration[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<AgentLoopResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is required for control-plane agent reasoning.");
  }
  const model = controlPlaneModel();

  const contents: GeminiContent[] = [
    { role: "user", parts: [{ text: params.userMessage }] },
  ];
  const transcript: TranscriptStep[] = [];
  let toolCallCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalText = "";

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const response = await callGemini(model, apiKey, {
      systemInstruction: { parts: [{ text: params.systemPrompt }] },
      contents,
      tools: [{ functionDeclarations: params.tools }],
      generationConfig: { temperature: 0.2 },
    });

    promptTokens += response.usageMetadata?.promptTokenCount ?? 0;
    completionTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts.filter(
      (part): part is GeminiPart & { functionCall: { name: string; args?: Record<string, unknown> } } =>
        Boolean(part.functionCall?.name),
    );
    const textParts = parts
      .map((part) => part.text ?? "")
      .filter((text) => text.trim().length > 0);
    for (const text of textParts) {
      transcript.push({ type: "text", text });
    }

    if (functionCalls.length === 0) {
      finalText = textParts.join("\n").trim();
      break;
    }

    contents.push({ role: "model", parts });

    const responseParts: GeminiPart[] = [];
    for (const call of functionCalls) {
      const name = call.functionCall.name;
      const args = call.functionCall.args ?? {};
      toolCallCount += 1;
      transcript.push({ type: "tool_call", name, args });

      if (toolCallCount > MAX_TOOL_CALLS) {
        const overBudget = { error: "Tool budget exhausted. Summarize your findings and finish." };
        transcript.push({ type: "tool_result", name, result: overBudget });
        responseParts.push({ functionResponse: { name, response: overBudget } });
        continue;
      }

      try {
        const result = await params.executeTool(name, args);
        const compact = truncateForModel(result);
        transcript.push({ type: "tool_result", name, result: compact });
        responseParts.push({
          functionResponse: { name, response: { result: compact } },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, tool: name }, "Control-plane tool execution failed");
        transcript.push({ type: "tool_result", name, result: null, error: message });
        responseParts.push({ functionResponse: { name, response: { error: message } } });
      }
    }

    contents.push({ role: "user", parts: responseParts });
  }

  if (!finalText) {
    finalText =
      transcript
        .filter((step): step is Extract<TranscriptStep, { type: "text" }> => step.type === "text")
        .map((step) => step.text)
        .join("\n")
        .trim() || "Run ended without a final summary (iteration budget reached).";
  }

  return { finalText, transcript, toolCallCount, promptTokens, completionTokens };
}
