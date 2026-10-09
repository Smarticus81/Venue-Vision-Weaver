import type { ControlProspect, ControlProspectFact, ControlProspectVetting } from "@workspace/db";
import {
  factsFromResearch,
  loadProspectAssets,
  loadProspectById,
  loadResearch,
  toAssetView,
  type AssetView,
  type EmailDetail,
} from "../outreach/studio.js";
import { loadFacts } from "./facts.js";
import { loadVetting } from "./vet.js";

/**
 * Everything the operator's Evidence panel shows for one prospect: the
 * verdict with every check and its evidence, the facts with their sources,
 * the research summary and the venue photos (vetting.md 1.8).
 */
export interface ControlProspectEvidence {
  prospect: ControlProspect;
  vetting: ControlProspectVetting | null;
  facts: ControlProspectFact[];
  research: EmailDetail["research"];
  assets: AssetView[];
}

export async function buildEvidence(prospectId: number): Promise<ControlProspectEvidence | null> {
  const prospect = await loadProspectById(prospectId);
  if (!prospect) return null;
  const [vetting, facts, research, assets] = await Promise.all([
    loadVetting(prospectId),
    loadFacts(prospectId),
    loadResearch(prospectId),
    loadProspectAssets(prospectId),
  ]);
  return {
    prospect,
    vetting,
    facts,
    research: research
      ? {
          status: research.status,
          facts: factsFromResearch(research, prospect),
          sourceUrls: research.sourceUrls,
          warnings: research.warnings,
          fetchedAt: research.fetchedAt,
        }
      : null,
    assets: assets.map((asset) => toAssetView(asset, new Set<number>())),
  };
}
