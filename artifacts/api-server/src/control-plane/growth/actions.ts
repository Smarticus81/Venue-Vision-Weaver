import type { ActionDefinition } from "../actions.js";

/**
 * Growth-owned governed actions, merged into ACTION_CATALOG by actions.ts
 * (`{ ...CORE_ACTIONS, ...growthActions }`). Empty in step 0; the growth
 * workstream adds send_lifecycle_email and send_operator_digest here
 * (low risk with a requiresApproval() policy gate). Import daily counters
 * from ../actionCounts.js, never from ../actions.js, to avoid a cycle.
 */
export const growthActions: Record<string, ActionDefinition> = {};
