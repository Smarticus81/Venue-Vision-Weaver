import type { AgentDefinition, AgentDomain } from "../types.js";
import { growthAgent } from "./growth.js";
import { activationAgent } from "./activation.js";
import { productAgent } from "./product.js";
import { supportAgent } from "./support.js";
import { financeAgent } from "./finance.js";
import { experimentsAgent } from "./experiments.js";
import { salesAgent } from "./sales.js";
import { governanceAgent } from "./governance.js";

/**
 * The fleet. Order matters at registration time only: it is the order a fresh
 * organisation's agents are provisioned in, and the order the console lists
 * them when nothing else is sorting.
 */
export const AGENT_REGISTRY: readonly AgentDefinition[] = [
  productAgent,
  supportAgent,
  activationAgent,
  growthAgent,
  financeAgent,
  experimentsAgent,
  salesAgent,
  governanceAgent,
];

const BY_KEY = new Map(AGENT_REGISTRY.map((agent) => [agent.key, agent]));

export function getAgent(key: string): AgentDefinition | undefined {
  return BY_KEY.get(key);
}

export function agentsForDomain(domain: AgentDomain): AgentDefinition[] {
  return AGENT_REGISTRY.filter((agent) => agent.domain === domain);
}

export const AGENT_KEYS = AGENT_REGISTRY.map((agent) => agent.key);

export {
  growthAgent,
  activationAgent,
  productAgent,
  supportAgent,
  financeAgent,
  experimentsAgent,
  salesAgent,
  governanceAgent,
};
export { classifyTicket } from "./support.js";
export { scoreLead } from "./sales.js";
export { judgeExperiment } from "./experiments.js";
