import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWebsiteInput, toVenueSlug } from "./venueSlug.ts";

test("toVenueSlug keeps word boundaries and folds accents", () => {
  assert.equal(toVenueSlug("The Willow House"), "the-willow-house");
  assert.equal(toVenueSlug("Willow&Oak"), "willow-oak");
  assert.equal(toVenueSlug("St. Mary's Barn"), "st-marys-barn");
  assert.equal(toVenueSlug("Château Élan"), "chateau-elan");
  assert.equal(toVenueSlug("   "), "");
});

test("toVenueSlug reduces a pasted link to its host", () => {
  assert.equal(toVenueSlug("https://www.willowhouse.com/tours?x=1"), "willowhouse");
  assert.equal(toVenueSlug("willowhouse.co.uk"), "willowhouse");
  assert.equal(toVenueSlug("not a url: really"), "not-a-url-really");
});

test("normalizeWebsiteInput adds https and rejects non-web schemes", () => {
  assert.equal(normalizeWebsiteInput("willowhouse.com"), "https://willowhouse.com/");
  assert.equal(normalizeWebsiteInput("http://willowhouse.com/tours"), "http://willowhouse.com/tours");
  assert.equal(normalizeWebsiteInput("javascript:alert(1)"), null);
  assert.equal(normalizeWebsiteInput("localhost"), null);
  assert.equal(normalizeWebsiteInput(""), null);
});
