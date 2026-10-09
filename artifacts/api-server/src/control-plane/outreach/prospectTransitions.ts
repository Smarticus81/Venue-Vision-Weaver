import { PROSPECT_TRANSITIONS, type ProspectStatus } from "@workspace/db";

/**
 * Operator-recorded prospect status moves. The shared transition table is
 * the rule, with two additions: re-recording the current status is a no-op
 * (an operator may update reply sentiment), and an unsubscribe is accepted
 * from any non-terminal status because consent always wins. Qualifying a
 * prospect additionally requires a passed vetting verdict.
 */
export type TransitionCheck = { ok: true; noop: boolean } | { ok: false; error: string };

export const VETTING_REQUIRED_FOR_QUALIFY = "Vetting has not passed for this prospect; run or override vetting first.";

export function checkProspectTransition(input: {
  from: string;
  to: string;
  vettingStatus: string;
}): TransitionCheck {
  const from = input.from as ProspectStatus;
  const to = input.to as ProspectStatus;
  if (from === to) return { ok: true, noop: true };
  const allowed = PROSPECT_TRANSITIONS[from] ?? [];
  const terminal = allowed.length === 0;
  if (!(allowed.includes(to) || (to === "unsubscribed" && !terminal))) {
    return {
      ok: false,
      error: terminal
        ? `Prospect is "${from}", which is final; its status cannot change.`
        : `A prospect cannot move from "${from}" to "${to}". Allowed: ${allowed.join(", ")}.`,
    };
  }
  if (to === "qualified" && input.vettingStatus !== "passed") return { ok: false, error: VETTING_REQUIRED_FOR_QUALIFY };
  return { ok: true, noop: false };
}
