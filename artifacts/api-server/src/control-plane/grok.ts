import { logger } from "../lib/logger.js";

/**
 * Grok function-calling loop over xAI's Responses API (the recommended
 * OpenAI-compatible surface; Chat Completions is deprecated at xAI). The
 * model reasons about the live business context and acts exclusively through
 * declared tools: custom function tools execute locally in the restricted
 * control-plane tool belt, and the server-side web_search tool (when enabled)
 * lets revenue agents do real prospect research on xAI's infrastructure.
 */

const XAI_API_BASE = () => (process.env.XAI_API_BASE_URL ?? "https://api.x.ai/v1").replace(/\/$/, "");

const DEFAULT_MODEL = "grok-4.7";

export function controlPlaneModel(): string {
  return process.env.CONTROL_PLANE_MODEL ?? process.env.XAI_MODEL ?? DEFAULT_MODEL;
}

export function controlPlaneAiConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}

/** Server-side Grok web search for prospect research; on by default when the key is set. */
export function controlPlaneWebSearchEnabled(): boolean {
  return controlPlaneAiConfigured() && process.env.CONTROL_PLANE_WEB_SEARCH !== "off";
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

interface ResponsesInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ResponsesFunctionCallOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

type ResponsesInputItem = ResponsesInputMessage | ResponsesFunctionCallOutput;

interface ResponsesOutputItem {
  type?: string;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  action?: Record<string, unknown>;
}

interface ResponsesApiResponse {
  id?: string;
  output?: ResponsesOutputItem[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string; code?: string | number } | string;
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

async function callGrok(apiKey: string, body: Record<string, unknown>): Promise<ResponsesApiResponse> {
  const res = await fetch(`${XAI_API_BASE()}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Grok request failed (${res.status}): ${text.slice(0, 600)}`);
  }
  const json = JSON.parse(text) as ResponsesApiResponse;
  if (json.error) {
    const message = typeof json.error === "string" ? json.error : json.error.message;
    throw new Error(`Grok error: ${message ?? "unknown"}`);
  }
  return json;
}

function messageText(items: ResponsesOutputItem[]): string[] {
  const texts: string[] = [];
  for (const item of items) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        texts.push(part.text);
      }
    }
  }
  return texts;
}

function parseArguments(raw: string | undefined): { args: Record<string, unknown>; error?: string } {
  if (!raw || !raw.trim()) return { args: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { args: parsed as Record<string, unknown> };
    }
    return { args: {}, error: "Tool arguments must be a JSON object." };
  } catch {
    return { args: {}, error: "Tool arguments were not valid JSON." };
  }
}

export async function runAgentLoop(params: {
  systemPrompt: string;
  userMessage: string;
  tools: ToolDeclaration[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  enableWebSearch?: boolean;
}): Promise<AgentLoopResult> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("XAI_API_KEY is required for control-plane agent reasoning.");
  }
  const model = controlPlaneModel();

  const toolsPayload: Array<Record<string, unknown>> = params.tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters ?? { type: "object", properties: {} },
  }));
  if (params.enableWebSearch && controlPlaneWebSearchEnabled()) {
    toolsPayload.push({ type: "web_search" });
  }

  const transcript: TranscriptStep[] = [];
  let toolCallCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let finalText = "";

  let input: ResponsesInputItem[] = [
    { role: "system", content: params.systemPrompt },
    { role: "user", content: params.userMessage },
  ];
  let previousResponseId: string | undefined;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const response = await callGrok(apiKey, {
      model,
      input,
      tools: toolsPayload,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    });

    promptTokens += response.usage?.input_tokens ?? 0;
    completionTokens += response.usage?.output_tokens ?? 0;
    previousResponseId = response.id;

    const output = response.output ?? [];
    for (const text of messageText(output)) {
      transcript.push({ type: "text", text });
    }
    // Server-side searches run on xAI infrastructure; surface them in the
    // transcript so operators can audit what the agent looked up.
    for (const item of output) {
      if (item.type === "web_search_call") {
        transcript.push({
          type: "tool_call",
          name: "web_search",
          args: (item.action as Record<string, unknown> | undefined) ?? {},
        });
      }
    }

    const functionCalls = output.filter(
      (item): item is ResponsesOutputItem & { call_id: string; name: string } =>
        item.type === "function_call" && Boolean(item.call_id) && Boolean(item.name),
    );

    if (functionCalls.length === 0) {
      finalText = messageText(output).join("\n").trim();
      break;
    }

    const outputs: ResponsesFunctionCallOutput[] = [];
    for (const call of functionCalls) {
      const name = call.name;
      const { args, error: argsError } = parseArguments(call.arguments);
      toolCallCount += 1;
      transcript.push({ type: "tool_call", name, args });

      if (toolCallCount > MAX_TOOL_CALLS) {
        const overBudget = { error: "Tool budget exhausted. Summarize your findings and finish." };
        transcript.push({ type: "tool_result", name, result: overBudget });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(overBudget),
        });
        continue;
      }
      if (argsError) {
        transcript.push({ type: "tool_result", name, result: null, error: argsError });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ error: argsError }),
        });
        continue;
      }

      try {
        const result = await params.executeTool(name, args);
        const compact = truncateForModel(result);
        transcript.push({ type: "tool_result", name, result: compact });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ result: compact }),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err, tool: name }, "Control-plane tool execution failed");
        transcript.push({ type: "tool_result", name, result: null, error: message });
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify({ error: message }),
        });
      }
    }

    input = outputs;
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