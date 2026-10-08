import { BRAND } from "@workspace/brand";
import { logger } from "../../lib/logger.js";
import { completeJson, controlPlaneAiConfigured } from "../grok.js";
import { citedFactsIn } from "../vetting/facts.js";
import { ROLE_NAME_WORDS } from "../vetting/lists.js";
import type { CitableFact } from "../vetting/types.js";
import { GENERIC_SPACE, SPACE_RE, type VenueFacts } from "./venueResearch.js";
import { outreachSenderFirstName } from "./config.js";

/**
 * Personal copy for one venue owner. Grok writes like a real person at
 * Dreemer; a strict validator keeps it short, plain, grounded in VERIFIED
 * facts (each with the page it was found on), and free of hype or invented
 * numbers. Every draft must cite at least two verified facts of different
 * kinds and may not name a space the site does not have. When Grok is not
 * configured (or fails twice), a deterministic template built from the same
 * verified facts is used and the draft notes say so.
 */

export interface CopyInput {
  facts: VenueFacts;
  /** Verified facts with sources; the only specifics the copy may cite. */
  verifiedFacts: CitableFact[];
  prospectName: string;
  /** A VERIFIED owner/manager name, or null ("Hi there,"). Role words never become a greeting. */
  contactName: string | null;
  /** "call" or "preview" — the one ask. */
  ask: "call" | "preview";
  /** Follow-up context: previous contact count and campaign guidance. */
  contactCount: number;
  stepGuidance: string | null;
  /** Growth copy-variant angle (control_copy_variants.angle); the fallback template ignores it. */
  variantAngle?: string | null;
  senderFirstName?: string;
}

export interface CopyDraft {
  subjects: [string, string];
  body: string;
  greeting: string;
  signOff: string;
  ctaLabel: string;
}

export interface CopyResult extends CopyDraft {
  notes: {
    source: "grok" | "fallback";
    wordCount: number;
    attempts: number;
    violations: string[];
    /** Verified facts the final draft actually cites. */
    citedFacts: CitableFact[];
  };
}

export const COPY_RULES = {
  maxSubjectChars: 50,
  maxBodyWords: 120,
  minBodyWords: 35,
  maxExclamations: 1,
  /** Distinct verified facts a draft must weave in (space, location, capacity, owner name). */
  minCitedFacts: 2,
} as const;

/** Hype, jargon, and claim-shaped phrases a personal note never uses. */
export const BANNED_PHRASES = [
  "revolutioni",
  "game-chang",
  "game chang",
  "cutting-edge",
  "cutting edge",
  "state-of-the-art",
  "unleash",
  "seamless",
  "supercharge",
  "leverage",
  "synergy",
  "best-in-class",
  "world-class",
  "next-level",
  "next level",
  "disrupt",
  "innovative",
  "elevate",
  "unlock",
  "skyrocket",
  "guarantee",
  "proven to",
  "studies show",
  "industry-leading",
  "ai-powered",
  "solution",
  "limited time",
  "act now",
  "don't miss",
  "free money",
  "100%",
];

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word)).length;
}

const ROLE_WORDS = new Set(ROLE_NAME_WORDS.map((word) => word.toLowerCase()));

/** True when a "contact name" is really a department or title (Events, Front Desk, Sales Team). */
export function isRoleName(name: string | null | undefined): boolean {
  if (!name) return false;
  const tokens = name
    .toLowerCase()
    .replace(/[^a-z' -]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  if (ROLE_WORDS.has(tokens[0]!)) return true;
  return tokens.every((token) => ROLE_WORDS.has(token) || token === "the" || token === "of" || token === "and");
}

/** First name for the greeting, or null when there is no real person to address. */
export function firstName(contactName: string | null): string | null {
  if (!contactName || isRoleName(contactName)) return null;
  const cleaned = contactName.replace(/[^a-zA-Z'’ -]/g, "").trim();
  if (!cleaned) return null;
  const first = cleaned.split(/\s+/)[0] ?? "";
  if (first.length < 2 || first.length > 20) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function normalizeSpace(value: string): string {
  return value.trim().replace(/^the\s+/i, "").replace(/\s+/g, " ").toLowerCase();
}

/**
 * Space-like phrases in the body that are not verified spaces: "the Rose
 * Garden" when the site only has a Barn and a Terrace. Single words
 * (a sentence-initial "Garden"), generic words, verified spaces and the
 * venue's own name are not flagged.
 */
export function inventedSpaces(body: string, input: Pick<CopyInput, "verifiedFacts" | "facts" | "prospectName">): string[] {
  const verified = new Set(input.verifiedFacts.filter((fact) => fact.kind === "space").map((fact) => normalizeSpace(fact.value)));
  const venueNames = [input.facts.name, input.prospectName]
    .filter((name): name is string => Boolean(name))
    .map((name) => normalizeSpace(name));
  const invented: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(SPACE_RE)) {
    const raw = match[1]?.replace(/\s+/g, " ").trim() ?? "";
    if (!raw) continue;
    const normalized = normalizeSpace(raw);
    if (!normalized.includes(" ")) continue;
    if (GENERIC_SPACE.test(raw) || GENERIC_SPACE.test(normalized)) continue;
    if (verified.has(normalized)) continue;
    if ([...verified].some((space) => space.includes(normalized) || normalized.includes(space))) continue;
    if (venueNames.some((name) => name.includes(normalized) || normalized.includes(name))) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    invented.push(raw);
  }
  return invented;
}

export function validateCopy(draft: CopyDraft, input: CopyInput): string[] {
  const violations: string[] = [];
  const subjects = draft.subjects;
  if (subjects.length !== 2) violations.push("exactly two subject options are required");
  subjects.forEach((subject, index) => {
    if (!subject.trim()) violations.push(`subject ${index + 1} is empty`);
    if (subject.length > COPY_RULES.maxSubjectChars) {
      violations.push(`subject ${index + 1} is ${subject.length} characters (max ${COPY_RULES.maxSubjectChars})`);
    }
    if (/[!]{1,}|\b(re|fwd?):/i.test(subject)) violations.push(`subject ${index + 1} must not shout or fake a reply`);
  });
  const words = countWords(draft.body);
  if (words > COPY_RULES.maxBodyWords) violations.push(`body is ${words} words (max ${COPY_RULES.maxBodyWords})`);
  if (words < COPY_RULES.minBodyWords) violations.push(`body is ${words} words (min ${COPY_RULES.minBodyWords})`);
  const exclamations = (draft.body.match(/!/g) ?? []).length;
  if (exclamations > COPY_RULES.maxExclamations) violations.push("body has too many exclamation marks");
  const lower = `${draft.body} ${subjects.join(" ")}`.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) violations.push(`uses "${phrase}"`);
  }
  if (/\b\d+(\.\d+)?\s*(%|percent|x\b)/i.test(draft.body) || /\b(\d{2,}|[2-9])\s*(times|x)\s+(more|faster|higher|better)/i.test(draft.body)) {
    violations.push("body contains a statistic or multiplier claim");
  }
  if (/\$\s?\d/.test(draft.body)) violations.push("body quotes a price");

  const cited = citedFactsIn({ greeting: draft.greeting, body: draft.body }, input.verifiedFacts);
  const kinds = new Set(cited.map((fact) => fact.kind));
  if (cited.length < COPY_RULES.minCitedFacts) {
    violations.push(
      `cites only ${cited.length} verified venue fact(s); weave in at least ${COPY_RULES.minCitedFacts} of: ${input.verifiedFacts
        .map((fact) => `${fact.kind} "${fact.value}"`)
        .join(", ")}`,
    );
  }
  if (input.verifiedFacts.some((fact) => fact.kind === "space") && !kinds.has("space")) {
    violations.push("body does not name any of the venue's actual spaces");
  }
  for (const space of inventedSpaces(draft.body, input)) {
    violations.push(`uses a space name that is not in the verified facts: "${space}"`);
  }

  if (!/dreemer/i.test(draft.body)) violations.push("body never says who is writing (Dreemer)");
  if (/\bdear\b/i.test(draft.greeting)) violations.push("greeting is too formal (no 'Dear')");
  if (/\{\{|\[\s*(name|venue|insert)/i.test(`${draft.body} ${draft.greeting}`)) violations.push("contains unfilled placeholders");
  if (/\n\s*-\s|\n\s*\*\s|\n\s*\d+\.\s/.test(draft.body)) violations.push("body uses bullet points");
  if (!draft.ctaLabel.trim() || draft.ctaLabel.length > 40) violations.push("call-to-action label missing or too long");
  return violations;
}

function strip(space: string): string {
  return space.replace(/^the\s+/i, "");
}

function capacityNumber(value: string): string | null {
  return value.match(/\d{2,4}/)?.[0] ?? null;
}

/**
 * Deterministic template built only from verified facts. Every pairing the
 * draft gate allows (space+location, space+owner, location+owner,
 * location+capacity, capacity+owner, two spaces) cites two facts and stays
 * under the word cap; longer venue names shed the optional sentences first.
 */
export function fallbackCopy(input: CopyInput): CopyDraft {
  const venue = input.facts.name ?? input.prospectName;
  const sender = input.senderFirstName ?? outreachSenderFirstName();
  const name = firstName(input.contactName);
  const spaces = input.verifiedFacts.filter((fact) => fact.kind === "space").slice(0, 2).map((fact) => fact.value);
  const location = input.verifiedFacts.find((fact) => fact.kind === "location")?.value ?? null;
  const capacityFact = input.verifiedFacts.find((fact) => fact.kind === "capacity")?.value ?? null;
  const capacity = capacityFact ? capacityNumber(capacityFact) : null;
  const where = location ? ` in ${location}` : "";

  const opener =
    input.contactCount > 0
      ? `I wrote a little while ago about ${venue} and did not want to leave it hanging.`
      : `I came across ${venue} while looking at wedding venues${where}.`;
  const spaceLine =
    spaces.length === 2
      ? `The ${strip(spaces[0]!)} and the ${strip(spaces[1]!)} look like places couples would want to picture their own day in.`
      : spaces.length === 1
        ? `The ${strip(spaces[0]!)} looks like a place couples would want to picture their own day in.`
        : `It looks like a place couples would want to picture their own day in.`;
  const capacityLine = capacity ? `Seating ${capacity} for dinner leaves room for the photos couples want to picture themselves in.` : "";
  const mechanismShort = `I work at ${BRAND.name}. After a couple tours with you, we make them a short personal preview of their wedding in your own spaces, so the conversation keeps going after they leave.`;
  const mechanismTail = ` Venues follow up the same week, while the visit is still fresh.`;
  const askFull =
    input.ask === "call"
      ? `Would a quick 15-minute call make sense? I can show you a preview from a venue like yours and you can decide from there.`
      : `Would you like a free preview made for ${venue}? Nothing to set up on your side, and you decide what to do with it once you see it.`;
  const askShort =
    input.ask === "call"
      ? `Would a quick 15-minute call make sense? You can decide from there.`
      : `Would you like a free preview made for your venue? Nothing to set up on your side.`;

  const assemble = (tail: boolean, ask: string): string =>
    [[opener, spaceLine, capacityLine].filter(Boolean).join(" "), `${mechanismShort}${tail ? mechanismTail : ""}`, ask].join("\n\n");

  let body = assemble(true, askFull);
  if (countWords(body) > COPY_RULES.maxBodyWords) body = assemble(false, askFull);
  if (countWords(body) > COPY_RULES.maxBodyWords) body = assemble(false, askShort);

  const subjectA = clampSubject(`A preview of weddings at ${venue}`, venue);
  const subjectB = clampSubject(input.ask === "call" ? `Quick question about ${venue}` : `${venue}, after the tour`, venue);

  return {
    subjects: [subjectA, subjectB],
    body,
    greeting: name ? `Hi ${name},` : "Hi there,",
    signOff: `Thanks,\n${sender} at ${BRAND.name}`,
    ctaLabel: input.ask === "call" ? "Find a time to talk" : "Ask for a free preview",
  };
}

export function clampSubject(subject: string, venue: string): string {
  const max = COPY_RULES.maxSubjectChars;
  if (subject.length <= max) return subject;
  // Shorten the venue name first, then hard-trim at a word boundary.
  const shortVenue = venue.split(/\s+/).slice(0, 3).join(" ");
  const retry = subject.replace(venue, shortVenue);
  if (retry.length <= max) return retry;
  const cut = retry.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 20)).replace(/[,\s]+$/, "");
}

function parseDraft(json: Record<string, unknown>, input: CopyInput): CopyDraft | null {
  const subjects = Array.isArray(json.subjects)
    ? json.subjects.filter((s): s is string => typeof s === "string").map((s) => s.trim())
    : [];
  const body = typeof json.body === "string" ? json.body.trim().replace(/\r\n/g, "\n") : "";
  if (subjects.length < 2 || !body) return null;
  const name = firstName(input.contactName);
  // The greeting may only carry the verified first name; anything else becomes "Hi there,".
  const proposed = typeof json.greeting === "string" ? json.greeting.trim() : "";
  const greeting = name
    ? proposed && new RegExp(`\\b${name}\\b`, "i").test(proposed) && !/\bdear\b/i.test(proposed)
      ? proposed
      : `Hi ${name},`
    : "Hi there,";
  const sender = input.senderFirstName ?? outreachSenderFirstName();
  const signOff =
    typeof json.signOff === "string" && json.signOff.trim() ? json.signOff.trim() : `Thanks,\n${sender} at ${BRAND.name}`;
  const ctaLabel = typeof json.ctaLabel === "string" && json.ctaLabel.trim() ? json.ctaLabel.trim() : "Ask for a free preview";
  return { subjects: [subjects[0]!, subjects[1]!], body, greeting, signOff, ctaLabel };
}

const SYSTEM_PROMPT = `You are a real person who works at ${BRAND.name} (${BRAND.domain}). You are writing one short email to the owner or manager of a specific wedding venue. ${BRAND.name} gives venues a personal AI preview of a couple's wedding in the venue's own spaces, sent after the couple tours, so the booking conversation keeps going. The theme is "${BRAND.tagline}".

Write the way you would write to one person you respect: plain words, short sentences, no hype, no jargon, no marketing voice. Mention the venue's actual spaces by name (only the ones provided). Explain plainly how ${BRAND.name} turns their tours into bookings. Make ONE simple ask (the one you are given: a short call or a free preview). Do not invent statistics, awards, customer names, prices, or any claim not in the facts. No bullet points, no exclamation marks, no "Dear", no emoji, no placeholders.

You are given a short list of VERIFIED FACTS about this venue, each with the page it was found on. Use at least two of them, from different kinds (a named space, the town, a stated guest count, the owner's first name in the greeting), exactly as written. Do not mention any space, place, number, or person that is not in the verified facts. If no owner name is given, greet with "Hi there,".

Return ONLY a JSON object: {"subjects": [two options, each under ${COPY_RULES.maxSubjectChars} characters, lowercase except names, no punctuation tricks], "greeting": "Hi <first name>," or "Hi there,", "body": "2-3 short paragraphs separated by blank lines, ${COPY_RULES.minBodyWords}-${COPY_RULES.maxBodyWords} words total, no greeting or sign-off inside", "signOff": "Thanks,\\n<sender first name> at ${BRAND.name}", "ctaLabel": "button text under 30 characters that matches the ask"}.`;

export async function writeCopy(input: CopyInput): Promise<CopyResult> {
  const sender = input.senderFirstName ?? outreachSenderFirstName();
  const verifiedFacts = input.verifiedFacts ?? [];
  const normalized: CopyInput = { ...input, verifiedFacts, senderFirstName: sender };
  const fallback = (): CopyResult => {
    const draft = fallbackCopy(normalized);
    return {
      ...draft,
      notes: {
        source: "fallback",
        wordCount: countWords(draft.body),
        attempts: 0,
        violations: [],
        citedFacts: citedFactsIn({ greeting: draft.greeting, body: draft.body }, verifiedFacts),
      },
    };
  };
  if (!controlPlaneAiConfigured()) return fallback();

  const venue = input.facts.name ?? input.prospectName;
  let feedback = "";
  let lastViolations: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { json } = await completeJson({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [
          `Sender first name: ${sender}`,
          `Recipient: ${firstName(input.contactName) ?? "(no verified name on file — use 'Hi there,')"} at ${venue}`,
          `The one ask: ${input.ask === "call" ? "a short 15-minute call" : "a free preview made for their venue"}`,
          `Previous emails to this person: ${input.contactCount}${input.contactCount > 0 ? " (this is a gentle follow-up; acknowledge briefly, add one new thought, do not repeat the first email)" : " (first touch)"}`,
          input.stepGuidance ? `Campaign guidance for this touch: ${input.stepGuidance}` : "",
          input.variantAngle ? `Angle for this note: ${input.variantAngle}` : "",
          `VERIFIED FACTS (cite at least ${COPY_RULES.minCitedFacts}, from different kinds): ${JSON.stringify(
            verifiedFacts.map(({ kind, value, sourceUrl }) => ({ kind, value, foundAt: sourceUrl })),
          )}`,
          `Background (style/summary, may paraphrase but not quote numbers): ${JSON.stringify({ venue, style: input.facts.style, summary: input.facts.summary })}`,
          feedback ? `Your previous draft was rejected for: ${feedback}. Fix every point.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        maxOutputTokens: 700,
      });
      const draft = parseDraft(json, normalized);
      if (!draft) {
        feedback = "the response was not in the required JSON shape";
        continue;
      }
      draft.subjects = [clampSubject(draft.subjects[0], venue), clampSubject(draft.subjects[1], venue)];
      const violations = validateCopy(draft, normalized);
      lastViolations = violations;
      if (violations.length === 0) {
        return {
          ...draft,
          notes: {
            source: "grok",
            wordCount: countWords(draft.body),
            attempts: attempt,
            violations: [],
            citedFacts: citedFactsIn({ greeting: draft.greeting, body: draft.body }, verifiedFacts),
          },
        };
      }
      feedback = violations.join("; ");
    } catch (err) {
      logger.warn({ err, attempt }, "Outreach copywriter: Grok draft failed");
      feedback = "the request failed";
    }
  }
  const result = fallback();
  result.notes.attempts = 2;
  result.notes.violations = lastViolations;
  return result;
}
