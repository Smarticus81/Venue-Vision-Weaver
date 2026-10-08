import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import type { PricingConfig, TrialConfig } from "@workspace/api-client-react";
import { formatMoney, perGalleryPrice } from "@/lib/publicConfig";
import { track } from "@/lib/track";

/*
 * Pricing cards (funnel-ux.md 3.7, monthly only per contract D1). Prices come
 * from the public config, never from this file. On the landing page every
 * card links to /create-venue; on the dashboard `onSelect` starts checkout.
 * One coral button per viewport: the Growth card's. Starter and the pack use
 * the ink hairline button.
 */

export type PricingProduct = "starter" | "growth" | "credit_pack";

export interface PricingCardsProps {
  pricing: PricingConfig;
  trial: TrialConfig;
  /** Dashboard mode: start checkout for the product. Undefined on the landing page. */
  onSelect?: (product: PricingProduct) => void;
  /** Dashboard mode: a one-line reason the buttons are disabled (e.g. billing not set up). */
  disabledReason?: string | null;
  /** Dashboard mode: which product is currently being purchased. */
  busyProduct?: PricingProduct | null;
  /** Dashboard mode: the plan the org is on, to label the current card. */
  currentPlan?: "starter" | "growth" | null;
  /** Where the cards appear, for tracking. */
  placement?: string;
}

export function PricingCards({
  pricing,
  trial,
  onSelect,
  disabledReason = null,
  busyProduct = null,
  currentPlan = null,
  placement = "pricing",
}: PricingCardsProps) {
  const c = pricing.currency;
  const starterPerGallery = formatMoney(perGalleryPrice(pricing.starterMonthly, pricing.starterCredits), c);
  const growthPerGallery = formatMoney(perGalleryPrice(pricing.growthMonthly, pricing.growthCredits), c);

  const cards: Array<{
    product: PricingProduct;
    name: string;
    price: string;
    cadence: string;
    quota: string;
    who: string;
    detail: string;
    recommended?: boolean;
    buyLabel: string;
  }> = [
    {
      product: "starter",
      name: "Starter",
      price: formatMoney(pricing.starterMonthly, c),
      cadence: "a month",
      quota: `${pricing.starterCredits} galleries a month`,
      who: "For one venue following up after every tour.",
      detail: `About ${starterPerGallery} per couple.`,
      buyLabel: "Choose Starter",
    },
    {
      product: "growth",
      name: "Growth",
      price: formatMoney(pricing.growthMonthly, c),
      cadence: "a month",
      quota: `${pricing.growthCredits} galleries a month`,
      who: "For several venues or a full tour calendar.",
      detail: `About ${growthPerGallery} per couple. Credits are shared across all your venues.`,
      recommended: true,
      buyLabel: "Choose Growth",
    },
    {
      product: "credit_pack",
      name: "Credit pack",
      price: formatMoney(pricing.creditPack, c),
      cadence: "one time",
      quota: `${pricing.creditPackCredits} galleries, added to any plan`,
      who: "For a busy weekend.",
      detail: "Pack credits never expire and are never clipped.",
      buyLabel: `Buy ${pricing.creditPackCredits} credits`,
    },
  ];

  return (
    <div className="pricing-cards">
      <ul>
        {cards.map((card) => {
          const primary = card.recommended;
          const className = primary ? "action-primary" : "action-secondary";
          const isCurrent = currentPlan === card.product;
          return (
            <li key={card.product} className={card.recommended ? "is-recommended" : undefined} data-product={card.product}>
              <div className="pricing-card-head">
                <h3>{card.name}</h3>
                {card.recommended ? <span className="pill">Recommended</span> : null}
                {isCurrent ? <span className="pill">Your plan</span> : null}
              </div>
              <p className="pricing-price">
                <strong>{card.price}</strong>
                <span>{card.cadence}</span>
              </p>
              <p className="pricing-quota">{card.quota}</p>
              <p className="pricing-who">{card.who}</p>
              <p className="pricing-detail">{card.detail}</p>
              {onSelect ? (
                <button
                  type="button"
                  className={className}
                  onClick={() => onSelect(card.product)}
                  disabled={Boolean(disabledReason) || busyProduct !== null || isCurrent}
                  aria-busy={busyProduct === card.product || undefined}
                >
                  {busyProduct === card.product ? "Opening checkout…" : isCurrent ? "Current plan" : card.buyLabel}
                </button>
              ) : (
                <Link
                  href="/create-venue"
                  className={className}
                  onClick={() => track("cta_click", { placement, product: card.product })}
                >
                  Start free {primary ? <ArrowRight size={18} aria-hidden /> : null}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {onSelect && disabledReason ? <p className="caption pricing-reason">{disabledReason}</p> : null}
      <p className="pricing-row">
        {pricing.label ? <span className="pill">{pricing.label}</span> : null}
        <span>
          Start free with {trial.credits} galleries, no card. Pick a plan when you are ready. One credit
          is one couple's gallery; failed renders are refunded automatically.
        </span>
      </p>
    </div>
  );
}
