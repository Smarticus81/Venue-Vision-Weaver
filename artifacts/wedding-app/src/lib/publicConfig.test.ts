import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PUBLIC_CONFIG,
  formatMoney,
  parsePublicConfig,
  perGalleryPrice,
  readPublicConfigFromDocument,
} from "./publicConfig.ts";

describe("parsePublicConfig", () => {
  it("returns null for non-objects", () => {
    assert.equal(parsePublicConfig(null), null);
    assert.equal(parsePublicConfig("x"), null);
    assert.equal(parsePublicConfig([1]), null);
  });

  it("keeps real values and fills gaps with defaults", () => {
    const parsed = parsePublicConfig({
      pricing: { starterMonthly: 99, growthMonthly: "bad", label: null },
      trial: { days: 7 },
      founding: { slotsLeft: 3, slotsTotal: 10 },
      proof: { mode: "partner" },
      contactEmail: "hello@example.com",
      billingConfigured: true,
      retentionDays: 45,
    });
    assert.ok(parsed);
    assert.equal(parsed.pricing.starterMonthly, 99);
    assert.equal(parsed.pricing.growthMonthly, DEFAULT_PUBLIC_CONFIG.pricing.growthMonthly);
    assert.equal(parsed.pricing.label, null);
    assert.equal(parsed.trial.days, 7);
    assert.equal(parsed.trial.credits, DEFAULT_PUBLIC_CONFIG.trial.credits);
    assert.deepEqual(parsed.founding, { slotsLeft: 3, slotsTotal: 10 });
    assert.equal(parsed.contactEmail, "hello@example.com");
    assert.equal(parsed.billingConfigured, true);
    assert.equal(parsed.retentionDays, 45);
  });

  it("drops the founding offer when no places are left", () => {
    const parsed = parsePublicConfig({ founding: { slotsLeft: 0, slotsTotal: 10 } });
    assert.equal(parsed?.founding, null);
    assert.equal(parsePublicConfig({ founding: null })?.founding, null);
  });

  it("only enters aggregate proof mode with aggregates attached", () => {
    const partner = parsePublicConfig({ proof: { mode: "aggregate" } });
    assert.equal(partner?.proof.mode, "partner");
    const aggregate = parsePublicConfig({
      proof: {
        mode: "aggregate",
        aggregates: { venues: 6, galleries: 80, openedRate: 61.5, ctaClickRate: 12, bookedCount: 4, since: "2026-09-01" },
      },
    });
    assert.equal(aggregate?.proof.mode, "aggregate");
    assert.equal(aggregate?.proof.aggregates?.openedRate, 61.5);
    assert.equal(aggregate?.proof.aggregates?.since, "2026-09-01");
  });
});

describe("readPublicConfigFromDocument", () => {
  it("parses the meta tag and tolerates garbage", () => {
    const stub = (content: string | null) => ({
      querySelector: (selector: string) =>
        selector.includes("dreemer-public-config") ? { getAttribute: () => content } : null,
    });
    const ok = readPublicConfigFromDocument(stub(JSON.stringify({ pricing: { creditPack: 49 } })));
    assert.equal(ok?.pricing.creditPack, 49);
    assert.equal(readPublicConfigFromDocument(stub("{not json")), null);
    assert.equal(readPublicConfigFromDocument(stub(null)), null);
    assert.equal(readPublicConfigFromDocument(undefined), null);
  });
});

describe("formatMoney / perGalleryPrice", () => {
  it("prints whole currency units", () => {
    assert.equal(formatMoney(129, "USD"), "$129");
    assert.equal(formatMoney(12_900, "USD"), "$12,900");
    assert.equal(formatMoney(37_410.4, "USD"), "$37,410");
    assert.equal(formatMoney(279, "GBP"), "£279");
  });
  it("survives an unknown currency code", () => {
    assert.equal(formatMoney(10, "NOPE!"), "NOPE! 10");
  });
  it("rounds the per-gallery figure to whole units with a floor of one", () => {
    assert.equal(perGalleryPrice(129, 25), 5);
    assert.equal(perGalleryPrice(279, 100), 3);
    assert.equal(perGalleryPrice(10, 100), 1);
    assert.equal(perGalleryPrice(59, 0), 59);
  });
});
