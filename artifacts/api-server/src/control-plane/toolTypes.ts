import type { ToolDeclaration } from "./grok.js";

/**
 * Shared shapes for every control-plane tool registry (core, vetting,
 * growth). Kept in its own module so the registries can import them without
 * creating an import cycle through tools.ts.
 */
export interface ToolContext {
  agentKey: string;
  runId: number;
}

export interface ControlPlaneTool {
  declaration: ToolDeclaration;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** Positive integer argument clamped to `max`, or `fallback` when missing/invalid. */
export function num(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Trimmed non-empty string argument, else null. */
export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}
