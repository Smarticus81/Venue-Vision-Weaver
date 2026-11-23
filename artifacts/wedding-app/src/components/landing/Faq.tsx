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
      q: "Is this a photo or a generated image?",
      a: "A generated preview, not a photograph. Images and reels are labelled as previews, with venue reference photos for context. Details and likeness can differ from reality. Review the results before sharing them with a couple.",
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
          The long version is on the <a href="/privacy" className="text-link">privacy and photo use</a> page.
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
