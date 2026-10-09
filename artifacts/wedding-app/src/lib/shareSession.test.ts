import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GeneratedAsset, VenueMediaItem } from "@workspace/api-client-react";
import {
  createdGalleryRecord,
  dateCtaFor,
  formatWeddingMonth,
  generationReferenceOrder,
  postGalleryEvent,
  processingDeliveryNote,
  processingPollInterval,
  realSpaceFor,
  rememberCreatedGallery,
  reelAsset,
  shareText,
  shareUrlFor,
  sortedStills,
  weddingMonthOptions,
  type KeyValueStore,
} from "./shareSession.ts";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function media(id: number, coverage: VenueMediaItem["coverage"], displayOrder: number): VenueMediaItem {
  return { id, venueId: 1, objectKey: `/objects/v${id}`, coverage, displayOrder, createdAt: "2026-10-01T00:00:00Z" };
}

function still(id: number, displayOrder: number, venueReferenceIndexes: number[] | null = null): GeneratedAsset {
  return { id, sessionId: 9, objectKey: `/objects/s${id}`, assetType: "image", displayOrder, venueReferenceIndexes };
}

describe("dateCtaFor", () => {
  const venue = {
    name: "Willow Barn",
    bookingUrl: "https://willow.example/tours?ref=site",
    websiteUrl: "https://willow.example",
    contactEmail: "events@willow.example",
  };

  it("points at the booking URL with utm tags and the wedding month", () => {
    const cta = dateCtaFor(venue, { weddingMonth: "2027-06" })!;
    assert.equal(cta.label, "Check your date at Willow Barn");
    assert.equal(cta.shortLabel, "Hold your date");
    assert.equal(cta.external, true);
    const url = new URL(cta.href);
    assert.equal(url.origin + url.pathname, "https://willow.example/tours");
    assert.equal(url.searchParams.get("ref"), "site");
    assert.equal(url.searchParams.get("utm_source"), "dreemer");
    assert.equal(url.searchParams.get("utm_medium"), "gallery");
    assert.equal(url.searchParams.get("utm_campaign"), "hold_your_date");
    assert.equal(url.searchParams.get("wedding_month"), "2027-06");
  });

  it("falls back to the website, adding a scheme when the venue left it off", () => {
    const cta = dateCtaFor({ ...venue, bookingUrl: null, websiteUrl: "willow.example" })!;
    assert.match(cta.href, /^https:\/\/willow\.example\/\?utm_source=dreemer&utm_medium=gallery/);
    assert.ok(!cta.href.includes("wedding_month"));
  });

  it("falls back to a mailto naming the month, and never says tour", () => {
    const cta = dateCtaFor(
      { ...venue, bookingUrl: "", websiteUrl: null },
      { weddingMonth: "2027-09", coupleName: "Ana & Sam" },
    )!;
    assert.equal(cta.external, false);
    assert.ok(cta.href.startsWith("mailto:events@willow.example?"));
    const params = new URLSearchParams(cta.href.split("?")[1]);
    assert.equal(params.get("subject"), "Our date at Willow Barn (September 2027)");
    assert.match(params.get("body")!, /availability for September 2027/);
    assert.match(params.get("body")!, /Ana & Sam/);
    assert.ok(!/tour/i.test(cta.label + cta.shortLabel));
  });

  it("ignores a malformed month and returns null with nowhere to send", () => {
    assert.ok(!dateCtaFor(venue, { weddingMonth: "2027-13" })!.href.includes("wedding_month"));
    assert.equal(dateCtaFor({ name: "Empty", bookingUrl: null, websiteUrl: null, contactEmail: null }), null);
    assert.equal(dateCtaFor({ name: "Bad", contactEmail: "not-an-email" }), null);
    assert.equal(dateCtaFor({ name: "Js", bookingUrl: "javascript:alert(1)" }), null);
    assert.equal(dateCtaFor(null), null);
  });
});

describe("wedding month", () => {
  it("formats valid months only", () => {
    assert.equal(formatWeddingMonth("2027-01"), "January 2027");
    assert.equal(formatWeddingMonth("2027-1"), null);
    assert.equal(formatWeddingMonth(null), null);
  });

  it("offers this month through three years ahead", () => {
    const options = weddingMonthOptions(new Date(2026, 9, 9));
    assert.equal(options.length, 37);
    assert.deepEqual(options[0], { value: "2026-10", label: "October 2026" });
    assert.deepEqual(options[3], { value: "2027-01", label: "January 2027" });
    assert.equal(options.at(-1)!.value, "2029-10");
  });
});

describe("share link and text", () => {
  it("builds the public share URL", () => {
    assert.equal(shareUrlFor("abc/def", "https://dreemer.co/"), "https://dreemer.co/v/abc%2Fdef");
  });

  it("names the venue in the share text", () => {
    assert.deepEqual(shareText({ shareToken: "t", venueName: "Willow Barn", coupleName: "Ana & Sam" }), {
      title: "Ana & Sam at Willow Barn",
      text: "An AI preview of our wedding at Willow Barn.",
    });
  });
});

describe("postGalleryEvent", () => {
  it("posts the event with keepalive to the by-token events path", async () => {
    const calls: { input: string; init: RequestInit }[] = [];
    const ok = await postGalleryEvent("tok_123", "cta_click", async (input, init) => {
      calls.push({ input, init });
      return { ok: true };
    });
    assert.equal(ok, true);
    assert.equal(calls[0]!.input, "/api/sessions/by-token/tok_123/events");
    assert.equal(calls[0]!.init.method, "POST");
    assert.equal(calls[0]!.init.keepalive, true);
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { type: "cta_click", source: "share_page" });
  });

  it("never throws when the network fails", async () => {
    assert.equal(
      await postGalleryEvent("tok", "shared", async () => {
        throw new Error("offline");
      }),
      false,
    );
    assert.equal(await postGalleryEvent("", "download", async () => ({ ok: true })), false);
  });
});

describe("creator marker", () => {
  it("round-trips the creator record per share token", () => {
    const store = memoryStore();
    rememberCreatedGallery(store, "tok", { venueSlug: "willow", email: "ana@example.com" });
    assert.deepEqual(createdGalleryRecord(store, "tok"), { venueSlug: "willow", email: "ana@example.com" });
    assert.equal(createdGalleryRecord(store, "other"), null);
    assert.equal(createdGalleryRecord(null, "tok"), null);
  });

  it("treats corrupt records as absent", () => {
    const store = memoryStore();
    store.setItem("dreemer:gallery-creator:tok", "{nope");
    assert.equal(createdGalleryRecord(store, "tok"), null);
  });
});

describe("stills and the real space", () => {
  const venueMedia = [
    media(10, "reception", 0),
    media(11, "exterior", 1),
    media(12, "detail", 2),
    media(13, "ceremony", 3),
    media(14, "exterior", 4),
    media(15, "natural_light", 5),
  ];

  it("orders references the way the pipeline does", () => {
    assert.deepEqual(
      generationReferenceOrder(venueMedia).map((m) => m.id),
      [11, 13, 10, 12, 15, 14],
    );
  });

  it("uses the still's anchor reference when recorded", () => {
    assert.equal(realSpaceFor(still(1, 1, [1, 0]), venueMedia)!.id, 13);
  });

  it("falls back to the scene's favoured coverage", () => {
    assert.equal(realSpaceFor(still(1, 1), venueMedia)!.coverage, "ceremony");
    assert.equal(realSpaceFor(still(2, 3, [99]), venueMedia)!.coverage, "exterior");
    assert.equal(realSpaceFor(still(3, 4), venueMedia)!.coverage, "reception");
    assert.equal(realSpaceFor(still(3, 4), []), null);
  });

  it("sorts stills and finds the reel", () => {
    const assets: GeneratedAsset[] = [
      still(3, 3),
      { ...still(9, 0), assetType: "video" },
      still(1, 1),
      still(2, 2),
    ];
    assert.deepEqual(sortedStills(assets).map((a) => a.displayOrder), [1, 2, 3]);
    assert.equal(reelAsset(assets)!.id, 9);
    assert.equal(reelAsset([]), null);
  });
});

describe("processingPollInterval", () => {
  it("backs off to 10s at five minutes and 30s after twenty", () => {
    assert.equal(processingPollInterval(0), 3_000);
    assert.equal(processingPollInterval(3 * 60_000), 5_000);
    assert.equal(processingPollInterval(5 * 60_000), 10_000);
    assert.equal(processingPollInterval(25 * 60_000), 30_000);
  });
});

describe("processingDeliveryNote", () => {
  it("promises the automatic email only when the venue does not review first", () => {
    assert.equal(
      processingDeliveryNote({ email: "a@b.co", venueName: "The Barn", reviewBeforeSend: false }),
      "Keep this link. We'll email it to a@b.co as soon as it's ready.",
    );
    assert.match(
      processingDeliveryNote({ email: "a@b.co", venueName: "The Barn", reviewBeforeSend: true }),
      /The Barn takes a quick look and sends it to a@b\.co/,
    );
    assert.equal(
      processingDeliveryNote({ email: " ", venueName: "The Barn", reviewBeforeSend: false }),
      "Keep this link: it's how you come back to the gallery.",
    );
  });
});
