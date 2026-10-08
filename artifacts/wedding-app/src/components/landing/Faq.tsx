import type { PublicConfig } from "@workspace/api-client-react";
import { formatMoney, perGalleryPrice } from "@/lib/publicConfig";

/*
 * FAQ (funnel-ux.md 3.9). Native <details>/<summary> so it works without
 * JavaScript and with every assistive technology. Figures come from config.
 */
export function faqEntries(config: PublicConfig): Array<{ q: string; a: string }> {
  const { pricing, trial, retentionDays } = config;
  const c = pricing.currency;
  return [
    {
      q: "Is this a photo or an AI image?",
      a: "An AI preview. Every image and the reel are labelled 'AI preview, imagined at {your venue}', and the real space photo sits beside each one. Your architecture is never altered.",
    },
    {
      q: "Who owns the images?",
      a: "The couple. They are made at their request, for them. You receive no rights to reuse them unless the couple agrees in writing.",
    },
    {
      q: "What happens to the couple's photos?",
      a: `Both partners agree before upload. Source photos are deleted ${retentionDays} days after the gallery is delivered. We store no face templates. Galleries are private links.`,
    },
    {
      q: "Who sees the gallery?",
      a: "Only people with the link. Nothing is public unless the couple shares it.",
    },
    {
      q: "What does it cost per couple?",
      a: `About ${formatMoney(perGalleryPrice(pricing.starterMonthly, pricing.starterCredits), c)} on Starter and ${formatMoney(perGalleryPrice(pricing.growthMonthly, pricing.growthCredits), c)} on Growth. One credit is one couple's gallery; failed renders are refunded automatically.`,
    },
    {
      q: "Do I need a card to start?",
      a: `No. ${trial.credits} galleries or ${trial.days} days, whichever comes first.`,
    },
  ];
}

export function Faq({ config, heading = "Questions venues ask first." }: { config: PublicConfig; heading?: string }) {
  const entries = faqEntries(config);
  return (
    <section className="faq-section page-width" aria-labelledby="faq-heading" id="faq">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Questions</p>
          <h2 id="faq-heading">{heading}</h2>
        </div>
        <p>
          The long version is on the <a href="/privacy" className="text-link">privacy and AI previews</a> page.
        </p>
      </div>
      <div className="faq-list">
        {entries.map((entry) => (
          <details key={entry.q}>
            <summary>{entry.q}</summary>
            <p>{entry.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
