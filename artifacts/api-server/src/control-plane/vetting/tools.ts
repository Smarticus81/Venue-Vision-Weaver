import { num } from "../toolTypes.js";
import type { ControlPlaneTool } from "../toolTypes.js";
import { loadProspectById } from "../outreach/studio.js";
import { citableFacts, loadFacts } from "./facts.js";
import { ensureVetted, loadVetting } from "./vet.js";

/**
 * Vetting-owned agent tools, merged into the registry by tools.ts
 * (vetting.md 3.2). Agents can read the verdict and the evidence and ask for
 * a re-run; they can never change the verdict — operators override in /control.
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
    async execute(args, ctx) {
      const prospectId = num(args.prospectId, 0, Number.MAX_SAFE_INTEGER);
      if (!prospectId) throw new Error("prospectId is required.");
      const prospect = await loadProspectById(prospectId);
      if (!prospect) throw new Error(`Prospect ${prospectId} not found.`);
      const { vetting } =
        args.refresh === true
          ? await ensureVetted(prospect, { force: true, requestedBy: ctx.agentKey })
          : { vetting: await loadVetting(prospectId) };
      const facts = await loadFacts(prospectId);
      return {
        vetting,
        facts,
        citable: citableFacts(facts),
        hint: vetting ? undefined : "Not vetted yet; call again with refresh=true.",
      };
    },
  },
};
