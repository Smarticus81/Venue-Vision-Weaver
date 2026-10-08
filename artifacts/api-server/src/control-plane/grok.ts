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
const MAX_STRING_CHARS = 2000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_RUN_BUDGET_MS = 8 * 60_000;

/** Per-request wall clock for one xAI call (GROK_TIMEOUT_MS, 5s-10min). */
export function grokRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.GROK_TIMEOUT_MS?.trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(10 * 60_000, Math.max(5_000, Math.floor(raw)));
}

/**
 * Wall-clock budget for one whole agent run (CONTROL_PLANE_RUN_BUDGET_MS,
 * 1-30 min, default 8). The scheduler runs agents one after another, so a
 * single run that keeps calling tools would otherwise hold the queue for
 * MAX_ITERATIONS × the request timeout plus every tool's own latency.
 */
export function agentRunBudgetMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CONTROL_PLANE_RUN_BUDGET_MS?.trim());
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RUN_BUDGET_MS;
  return Math.min(30 * 60_000, Math.max(60_000, Math.floor(raw)));
}

/**
 * A failed or timed-out xAI request. `status` is the HTTP status (0 for a
 * timeout or network failure) so the runner can tell quota/outage errors
 * (429, 5xx) from the agent's own mistakes and avoid advancing its schedule.
 */
export class GrokRequestError extends Error {
  readonly status: number;
  readonly timedOut: boolean;
  constructor(message: string, options: { status: number; timedOut?: boolean }) {
    super(message);
    this.name = "GrokRequestError";
    this.status = options.status;
    this.timedOut = options.timedOut ?? false;
  }
  /** 429 and 5xx (and timeouts) are the provider's problem, not the agent's. */
  get transient(): boolean {
    return this.timedOut || this.status === 429 || this.status >= 500;
  }
}

function shrinkValue(value: unknown, budget: { remaining: number }): unknown {
  if (budget.remaining <= 0) return undefined;
  if (typeof value === "string") {
    const cut = Math.min(value.length, MAX_STRING_CHARS, Math.max(budget.remaining, 0));
    budget.remaining -= cut + 2;
    return cut < value.length ? `${value.slice(0, cut)}…[${value.length - cut} more chars]` : value;
  }
  if (value === null || typeof value !== "object") {
    budget.remaining -= JSON.stringify(value)?.length ?? 4;
    return value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (budget.remaining <= 0) {
        out.push(`…[${value.length - index} more items]`);
        break;
      }
      out.push(shrinkValue(value[index], budget));
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (let index = 0; index < entries.length; index += 1) {
    const [key, entry] = entries[index];
    if (budget.remaining <= 0) {
      out.__truncated = `${entries.length - index} more fields omitted`;
      break;
    }
    budget.remaining -= key.length + 4;
    out[key] = shrinkValue(entry, budget);
  }
  return out;
}

/**
 * Keep tool results inside the model budget without slicing JSON mid-string:
 * long strings are shortened with a marker, arrays and objects are cut at an
 * element boundary and say how much was dropped, so the model still receives
 * valid structure it can reason about.
 */
export function truncateForModel(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (json === undefined || json.length <= MAX_TOOL_RESULT_CHARS) return value;
  const compact = shrinkValue(value, { remaining: MAX_TOOL_RESULT_CHARS });
  return { truncated: true, originalLength: json.length, result: compact };
}

async function callGrok(
  apiKey: string,
  body: Record<string, unknown>,
  options: { deadline?: number } = {},
): Promise<ResponsesApiResponse> {
  // One request never outlives the run it belongs to.
  const remaining = options.deadline === undefined ? Infinity : options.deadline - Date.now();
  if (remaining <= 0) {
    throw new GrokRequestError("Agent run budget exhausted before the request was sent", {
      status: 0,
      timedOut: true,
    });
  }
  const timeoutMs = Math.max(1_000, Math.min(grokRequestTimeoutMs(), remaining));
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${XAI_API_BASE()}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new GrokRequestError(
      timedOut
        ? `Grok request timed out after ${timeoutMs}ms`
        : `Grok request failed: ${err instanceof Error ? err.message : String(err)}`,
      { status: 0, timedOut },
    );
  }
  if (!res.ok) {
    throw new GrokRequestError(`Grok request failed (${res.status}): ${text.slice(0, 600)}`, {
      status: res.status,
    });
  }
  let json: ResponsesApiResponse;
  try {
    json = JSON.parse(text) as ResponsesApiResponse;
  } catch {
    throw new GrokRequestError(`Grok returned a non-JSON body: ${text.slice(0, 200)}`, {
      status: res.status,
    });
  }
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

/**
 * One-shot structured completion (no tools, no web search): the model answers
 * with a single JSON object. Used by the outreach studio for grounded fact
 * extraction and copywriting, where the inputs are already fetched and the
 * model must not go looking for more.
 */
export async function completeJson(params: {
  systemPrompt: string;
  userMessage: string;
  maxOutputTokens?: number;
}): Promise<{ json: Record<string, unknown>; raw: string; promptTokens: number; completionTokens: number }> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("XAI_API_KEY is required for control-plane reasoning.");
  }
  const response = await callGrok(apiKey, {
    model: controlPlaneModel(),
    input: [
      { role: "system", content: params.systemPrompt },
      { role: "user", content: params.userMessage },
    ],
    text: { format: { type: "json_object" } },
    ...(params.maxOutputTokens ? { max_output_tokens: params.maxOutputTokens } : {}),
  });
  const raw = messageText(response.output ?? []).join("\n").trim();
  const json = parseJsonObject(raw);
  if (!json) {
    throw new Error("Grok did not return a JSON object.");
  }
  return {
    json,
    raw,
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
  };
}

/** Tolerant JSON-object parse: strips code fences and leading prose. */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw.trim()];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.unshift(fenced[1].trim());
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export async function runAgentLoop(params: {
  systemPrompt: string;
  userMessage: string;
  tools: ToolDeclaration[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  enableWebSearch?: boolean;
  /** Overrides CONTROL_PLANE_RUN_BUDGET_MS for this run. */
  budgetMs?: number;
}): Promise<AgentLoopResult> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("XAI_API_KEY is required for control-plane agent reasoning.");
  }
  const model = controlPlaneModel();
  const startedAt = Date.now();
  const deadline = startedAt + (params.budgetMs ?? agentRunBudgetMs());
  let budgetExhausted = false;

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
    if (Date.now() >= deadline) {
      budgetExhausted = true;
      break;
    }
    const response = await callGrok(
      apiKey,
      {
        model,
        input,
        tools: toolsPayload,
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
      },
      { deadline },
    );

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

      // Past the wall clock, pending calls are answered with the budget
      // notice instead of being executed: the model still gets a valid
      // function_call_output for every call_id, and the run ends on the
      // next iteration without another tool round.
      if (toolCallCount > MAX_TOOL_CALLS || Date.now() >= deadline) {
        const overBudget = {
          error:
            Date.now() >= deadline
              ? "Run time budget exhausted. Summarize your findings and finish."
              : "Tool budget exhausted. Summarize your findings and finish.",
        };
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
    const texts = transcript
      .filter((step): step is Extract<TranscriptStep, { type: "text" }> => step.type === "text")
      .map((step) => step.text)
      .join("\n")
      .trim();
    const reason = budgetExhausted
      ? `time budget of ${Math.round((deadline - startedAt) / 1000)}s reached`
      : "iteration budget reached";
    finalText = texts || `Run ended without a final summary (${reason}).`;
    if (budgetExhausted) {
      logger.warn(
        { toolCallCount, elapsedMs: Date.now() - startedAt },
        "Control-plane agent run stopped at its wall-clock budget",
      );
    }
  }

  return { finalText, transcript, toolCallCount, promptTokens, completionTokens };
}