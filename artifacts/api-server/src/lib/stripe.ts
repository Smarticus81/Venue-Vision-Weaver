import Stripe from "stripe";
import { logger } from "./logger.js";
import { getAppBaseUrl as resolveAppBaseUrl } from "./appUrl.js";

const secretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = secretKey ? new Stripe(secretKey) : null;

export const STRIPE_PRICES = {
  starter: process.env.STRIPE_PRICE_STARTER_MONTHLY ?? "",
  growth: process.env.STRIPE_PRICE_GROWTH_MONTHLY ?? "",
  credit_pack: process.env.STRIPE_PRICE_CREDIT_PACK_10 ?? "",
} as const;

export type BillingProduct = keyof typeof STRIPE_PRICES;

export function getAppBaseUrl(): string {
  return resolveAppBaseUrl();
}

export function requireStripe(): Stripe {
  if (!stripe) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return stripe;
}

export function isStripeConfigured(): boolean {
  return !!stripe && !!STRIPE_PRICES.starter && !!STRIPE_PRICES.growth && !!STRIPE_PRICES.credit_pack;
}

export function logStripeMissing(): void {
  if (!isStripeConfigured()) {
    logger.warn("Stripe billing is not fully configured - checkout disabled");
  }
}
