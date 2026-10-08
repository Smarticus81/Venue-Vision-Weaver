import { BRAND } from "@workspace/brand";
import { logger } from "../../lib/logger.js";
import { completeJson, controlPlaneAiConfigured } from "../grok.js";
import type { VenueFacts } from "./venueResearch.js";
import { outreachSenderFirstName } from "./config.js";

/**
 * Personal copy for one venue owner. Grok writes like a real person at
 * Dreemer; a strict validator keeps it short, plain, grounded in the facts we
 * actually found, and free of hype or invented numbers. When Grok is not
 * configured (or fails twice), a deterministic template built from the same
 * facts is used and the draft notes say so.
 */

export interface CopyInput {
  facts: VenueFacts;
  prospectName: string;
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
  };
}

export const COPY_RULES = {
  maxSubjectChars: 50,
  maxBodyWords: 120,
  minBodyWords: 35,
  maxExclamations: 1,
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

function firstName(contactName: string | null): string | null {
  if (!contactName) return null;
  const cleaned = contactName.replace(/[^a-zA-Z'’ -]/g, "").trim();
  if (!cleaned) return null;
  const first = cleaned.split(/\s+/)[0] ?? "";
  if (first.length < 2 || first.length > 20) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
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
    if (/[!]{1,}|\b(re|fwd):/i.test(subject)) violations.push(`subject ${index + 1} must not shout or fake a reply`);
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
  if (input.facts.spaces.length > 0) {
    const mentioned = input.facts.spaces.some((space) =>
      lower.includes(space.toLowerCase().replace(/^the\s+/, "")),
    );
    if (!mentioned) violations.push("body does not mention any of the venue's actual spaces");
  }
  if (!/dreemer/i.test(draft.body)) violations.push("body never says who is writing (Dreemer)");
  if (/\bdear\b/i.test(draft.greeting)) violations.push("greeting is too formal (no 'Dear')");
  if (/\{\{|\[\s*(name|venue|insert)/i.test(`${draft.body} ${draft.greeting}`)) violations.push("contains unfilled placeholders");
  if (/\n\s*-\s|\n\s*\*\s|\n\s*\d+\.\s/.test(draft.body)) violations.push("body uses bullet points");
  if (!draft.ctaLabel.trim() || draft.ctaLabel.length > 40) violations.push("call-to-action label missing or too long");
  return violations;
}

export function fallbackCopy(input: CopyInput): CopyDraft {
  const venue = input.facts.name ?? input.prospectName;
  const sender = input.senderFirstName ?? outreachSenderFirstName();
  const name = firstName(input.contactName);
  const spaces = input.facts.spaces.slice(0, 2);
  const where = input.facts.location ? ` in ${input.facts.location}` : "";

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
  const mechanism = `I work at ${BRAND.name}. After a couple tours with you, we make them a short, personal preview of their wedding in your actual spaces, so the conversation keeps going once they leave. Venues use it to follow up the same week, while the visit is still fresh.`;
  const ask =
    input.ask === "call"
      ? `Would a quick 15-minute call make sense? I can show you a preview from a venue like yours and you can decide from there.`
      : `Would you like a free preview made for ${venue}? There is nothing to set up on your side, and you can decide what to do with it after you see it.`;

  const body = [`${opener} ${spaceLine}`, mechanism, ask].join("\n\n");
  const subjectA = clampSubject(`A preview of weddings at ${venue}`, venue);
  const subjectB = clampSubject(input.ask === "call" ? `Quick question about ${venue}` : `${venue}, after the tour`, venue);

  return {
    subjects: [subjectA, subjectB],
    body,
    greeting: name ? `Hi ${name},` : "Hi there,",
    signOff: `Thanks,\n${sender}\n${sender} at ${BRAND.name}`.replace(`${sender}\n${sender} at`, `${sender} at`),
    ctaLabel: input.ask === "call" ? "Find a time to talk" : "Ask for a free preview",
  };
}

function strip(space: string): string {
  return space.replace(/^the\s+/i, "");
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
  const greeting =
    typeof json.greeting === "string" && json.greeting.trim() ? json.greeting.trim() : name ? `Hi ${name},` : "Hi there,";
  const sender = input.senderFirstName ?? outreachSenderFirstName();
  const signOff =
    typeof json.signOff === "string" && json.signOff.trim() ? json.signOff.trim() : `Thanks,\n${sender} at ${BRAND.name}`;
  const ctaLabel = typeof json.ctaLabel === "string" && json.ctaLabel.trim() ? json.ctaLabel.trim() : "Ask for a free preview";
  return { subjects: [subjects[0]!, subjects[1]!], body, greeting, signOff, ctaLabel };
}

const SYSTEM_PROMPT = `You are a real person who works at ${BRAND.name} (${BRAND.domain}). You are writing one short email to the owner or manager of a specific wedding venue. ${BRAND.name} gives venues a personal AI preview of a couple's wedding in the venue's own spaces, sent after the couple tours, so the booking conversation keeps going. The theme is "${BRAND.tagline}".

Write the way you would write to one person you respect: plain words, short sentences, no hype, no jargon, no marketing voice. Mention the venue's actual spaces by name (only the ones provided). Explain plainly how ${BRAND.name} turns their tours into bookings. Make ONE simple ask (the one you are given: a short call or a free preview). Do not invent statistics, awards, customer names, prices, or any claim not in the facts. No bullet points, no exclamation marks, no "Dear", no emoji, no placeholders.

Return ONLY a JSON object: {"subjects": [two options, each under ${COPY_RULES.maxSubjectChars} characters, lowercase except names, no punctuation tricks], "greeting": "Hi <first name>," or "Hi there,", "body": "2-3 short paragraphs separated by blank lines, ${COPY_RULES.minBodyWords}-${COPY_RULES.maxBodyWords} words total, no greeting or sign-off inside", "signOff": "Thanks,\\n<sender first name> at ${BRAND.name}", "ctaLabel": "button text under 30 characters that matches the ask"}.`;

export async function writeCopy(input: CopyInput): Promise<CopyResult> {
  const sender = input.senderFirstName ?? outreachSenderFirstName();
  const fallback = (): CopyResult => {
    const draft = fallbackCopy({ ...input, senderFirstName: sender });
    return {
      ...draft,
      notes: { source: "fallback", wordCount: countWords(draft.body), attempts: 0, violations: [] },
    };
  };
  if (!controlPlaneAiConfigured()) return fallback();

  const facts = {
    venue: input.facts.name ?? input.prospectName,
    location: input.facts.location,
    spaces: input.facts.spaces,
    style: input.facts.style,
    capacity: input.facts.capacity,
    summary: input.facts.summary,
  };
  let feedback = "";
  let lastViolations: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { json } = await completeJson({
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [
          `Sender first name: ${sender}`,
          `Recipient: ${input.contactName ?? "(no name on file — use 'Hi there,')"} at ${facts.venue}`,
          `The one ask: ${input.ask === "call" ? "a short 15-minute call" : "a free preview made for their venue"}`,
          `Previous emails to this person: ${input.contactCount}${input.contactCount > 0 ? " (this is a gentle follow-up; acknowledge briefly, add one new thought, do not repeat the first email)" : " (first touch)"}`,
          input.stepGuidance ? `Campaign guidance for this touch: ${input.stepGuidance}` : "",
          input.variantAngle ? `Angle for this note: ${input.variantAngle}` : "",
          `Venue facts (the only facts you may use): ${JSON.stringify(facts)}`,
          feedback ? `Your previous draft was rejected for: ${feedback}. Fix every point.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        maxOutputTokens: 700,
      });
      const draft = parseDraft(json, { ...input, senderFirstName: sender });
      if (!draft) {
        feedback = "the response was not in the required JSON shape";
        continue;
      }
      draft.subjects = [clampSubject(draft.subjects[0], facts.venue), clampSubject(draft.subjects[1], facts.venue)];
      const violations = validateCopy(draft, input);
      lastViolations = violations;
      if (violations.length === 0) {
        return {
          ...draft,
          notes: { source: "grok", wordCount: countWords(draft.body), attempts: attempt, violations: [] },
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
