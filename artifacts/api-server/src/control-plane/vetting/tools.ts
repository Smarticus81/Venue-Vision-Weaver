import type { ControlPlaneTool } from "../toolTypes.js";

/**
 * Vetting-owned agent tools, merged into the registry by tools.ts. Step 0
 * ships the declaration (vetting.md 3.2 verbatim) with a stub body so the
 * grants in agents.ts resolve; the vetting workstream fills the execute.
 */
export const vettingTools: Record<string, ControlPlaneTool> = {
  vet_prospect: {
    declaration: {
      name: "vet_prospect",
      description:
        "Legitimacy vetting for one prospect: the verdict (passed / review / failed / error), 0-100 score, every check with its evidence URL and timestamp, and the verified facts (spaces, location, capacity, owner name, phone, address, marketplace and social presence, Google listing). Set refresh=true to re-run the checks (network; only when missing, expired, or the site changed). You cannot change the verdict; operators can override it in /control.",
      parameters: {
        type: "object",
        properties: { prospectId: { type: "integer" }, refresh: { type: "boolean" } },
        required: ["prospectId"],
      },
    },
    async execute() {
      return { ok: false, reason: "not implemented yet" };
    },
  },
};
