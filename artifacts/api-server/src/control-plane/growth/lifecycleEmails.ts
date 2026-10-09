import { CREDIT_PACK_AMOUNT, GROWTH_MONTHLY_CREDITS, STARTER_MONTHLY_CREDITS, TRIAL_CREDITS } from "@workspace/db";
import { dashboardUrl, nudgeDaysBeforeEnd, pricingUrl } from "./config.js";
import { growthCtaButton, growthEmailLayout, paragraphsHtml, plainText } from "./emailRender.js";

/*
 * Fixed trial lifecycle templates (growth-loop.md 7.6). Plain words, no
 * hype, no exclamation marks, and no number we did not compute: every figure
 * comes from the frozen action context or from the lib/db plan constants.
 * Galleries are "made", never "seen" — we do not know the couple opened one
 * unless first_viewed_at says so, and that is not in the context.
 */

export const LIFECYCLE_TEMPLATES = ["trial_gallery_3", "trial_day_10", "trial_credits_out", "trial_expired"] as const;
export type LifecycleTemplate = (typeof LIFECYCLE_TEMPLATES)[number];

export interface LifecycleContext {
  orgName: string;
  venueName: string | null;
  creditsBalance: number;
  /** ISO timestamp or null (legacy rows before the clock existed). */
  trialEndsAt: string | null;
  galleriesReady: number;
  firstGalleryShareUrl: string | null;
}

export interface RenderedLifecycleEmail {
  subject: string;
  paragraphs: string[];
  cta: { label: string; href: string };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 22" in UTC; "soon" when the date is unknown or unparsable. */
export function formatShortDate(iso: string | null): string {
  if (!iso) return "soon";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "soon";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function lifecycleTemplateTitle(template: LifecycleTemplate): string {
  switch (template) {
    case "trial_gallery_3":
      return "Trial nudge (galleries made)";
    case "trial_day_10":
      return "Trial nudge (ending soon)";
    case "trial_credits_out":
      return "Trial nudge (credits used up)";
    case "trial_expired":
      return "Trial ended";
  }
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function renderLifecycleEmail(template: LifecycleTemplate, ctx: LifecycleContext): RenderedLifecycleEmail {
  const venue = ctx.venueName?.trim() || "your venue";
  const date = formatShortDate(ctx.trialEndsAt);
  const n = Math.max(0, Math.floor(ctx.creditsBalance));
  const g = Math.max(0, Math.floor(ctx.galleriesReady));
  const t = TRIAL_CREDITS;
  const d = nudgeDaysBeforeEnd();
  const pricing = pricingUrl();
  const dashboard = dashboardUrl();

  switch (template) {
    case "trial_gallery_3":
      return {
        subject: `${plural(g, "gallery", "galleries")} made at ${venue}`,
        paragraphs: [
          `Hi there — ${plural(g, "couple")} now ${g === 1 ? "has" : "have"} a gallery of themselves at ${venue}.`,
          `You have ${plural(n, "trial gallery", "trial galleries")} left, and the trial runs until ${date}.`,
          `If these are helping tours turn into bookings, Starter gives you ${STARTER_MONTHLY_CREDITS} galleries a month and Growth gives you ${GROWTH_MONTHLY_CREDITS}. A ${CREDIT_PACK_AMOUNT}-pack works if you would rather pay as you go. Nothing changes until you choose.`,
        ],
        cta: { label: "See plans", href: pricing },
      };
    case "trial_day_10":
      if (g > 0) {
        return {
          subject: `Your Dreemer trial ends ${date}`,
          paragraphs: [
            `Hi there — your trial at ${venue} ends on ${date}. You have ${plural(n, "gallery", "galleries")} left.`,
            "Your galleries and share links stay live after that; new galleries start again when you pick a plan or a pack.",
            "Reply to this email if you want help choosing.",
          ],
          cta: { label: "Choose a plan", href: pricing },
        };
      }
      return {
        subject: `${plural(d, "day")} left — want help with your first gallery?`,
        paragraphs: [
          `Hi there — your trial at ${venue} ends on ${date} and no couple has made a gallery yet.`,
          "The fastest route: upload a few photos of your main spaces, then share the couple link or QR at the end of your next tour. The gallery is usually ready in a few minutes.",
          "Reply to this email and we will walk through it with you.",
        ],
        cta: { label: "Open your dashboard", href: dashboard },
      };
    case "trial_credits_out":
      return {
        subject: `You have used all ${t} trial galleries`,
        paragraphs: [
          `Hi there — all ${t} trial galleries at ${venue} have been used.`,
          `Everything you made stays live. To keep going, pick Starter, Growth, or a ${CREDIT_PACK_AMOUNT}-pack; the next gallery starts as soon as the balance is back.`,
        ],
        cta: { label: "Add galleries", href: pricing },
      };
    case "trial_expired":
      return {
        subject: "Your trial has ended — your galleries are safe",
        paragraphs: [
          `Hi there — the free trial for ${venue} ended on ${date}.`,
          "Nothing has been deleted: every gallery and share link still works, and your venue page is still up.",
          `New galleries resume the moment you choose a plan or a ${CREDIT_PACK_AMOUNT}-pack.`,
        ],
        cta: { label: "Pick up where you left off", href: pricing },
      };
  }
}

/** Full message for the transactional sender: subject, branded HTML and a plain-text twin. */
export function renderLifecycleMessage(
  template: LifecycleTemplate,
  ctx: LifecycleContext,
): { subject: string; html: string; text: string } {
  const rendered = renderLifecycleEmail(template, ctx);
  const body = `${paragraphsHtml(rendered.paragraphs)}\n${growthCtaButton(rendered.cta.href, rendered.cta.label)}`;
  return {
    subject: rendered.subject,
    html: growthEmailLayout(rendered.subject, body, { preheader: rendered.paragraphs[0] }),
    text: plainText(rendered.paragraphs, rendered.cta),
  };
}
