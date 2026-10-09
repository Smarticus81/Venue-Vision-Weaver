import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFunnelEvent, deriveFirstTouch } from "./track.ts";

const now = new Date("2026-10-08T12:00:00Z");

describe("deriveFirstTouch", () => {
  it("labels a claim link as the source and keeps the token", () => {
    const ft = deriveFirstTouch("https://dreemer.co/claim/abc123?utm_source=outreach", null, now);
    assert.equal(ft.source, "claim");
    assert.equal(ft.claimToken, "abc123");
    assert.equal(ft.utm.source, "outreach");
    assert.equal(ft.landing, "/claim/abc123?utm_source=outreach");
    assert.equal(ft.at, now.toISOString());
  });

  it("reads a claim token from the signup query too", () => {
    const ft = deriveFirstTouch("https://dreemer.co/create-venue?claim=tok&venue=Willow", null, now);
    assert.equal(ft.source, "claim");
    assert.equal(ft.claimToken, "tok");
  });

  it("builds utm sources with the medium when present", () => {
    const ft = deriveFirstTouch("https://dreemer.co/?utm_source=newsletter&utm_medium=email&utm_campaign=oct", null, now);
    assert.equal(ft.source, "utm:newsletter/email");
    assert.deepEqual(ft.utm, { source: "newsletter", medium: "email", campaign: "oct" });
    assert.equal(ft.claimToken, null);
  });

  it("falls back to ref, then an external referrer, then direct", () => {
    assert.equal(deriveFirstTouch("https://dreemer.co/?ref=partner", null, now).source, "ref:partner");
    const referred = deriveFirstTouch("https://dreemer.co/pricing", "https://www.example.com/blog/post", now);
    assert.equal(referred.source, "referrer:example.com");
    assert.equal(referred.referrer, "example.com");
    assert.equal(deriveFirstTouch("https://dreemer.co/", "https://www.dreemer.co/pricing", now).source, "direct");
    assert.equal(deriveFirstTouch("https://dreemer.co/", "not a url", now).source, "direct");
  });

  it("caps the source label at 80 characters", () => {
    const long = "x".repeat(200);
    const ft = deriveFirstTouch(`https://dreemer.co/?ref=${long}`, null, now);
    assert.equal(ft.source.length, 80);
  });

  it("survives a malformed page url", () => {
    const ft = deriveFirstTouch("http://", null, now);
    assert.equal(ft.source, "direct");
    assert.equal(ft.landing, "/");
  });
});

describe("buildFunnelEvent", () => {
  it("attaches path and first touch and mirrors the source field", () => {
    const ft = deriveFirstTouch("https://dreemer.co/claim/t1", null, now);
    const body = buildFunnelEvent("cta_click", { placement: "hero" }, ft, "/?x=1");
    assert.equal(body.event, "cta_click");
    assert.equal(body.source, "claim");
    assert.equal(body.properties?.placement, "hero");
    assert.equal(body.properties?.path, "/?x=1");
    assert.deepEqual((body.properties?.firstTouch as { claimToken: string }).claimToken, "t1");
  });

  it("omits source without a first touch", () => {
    const body = buildFunnelEvent("landing_view", undefined, null, "/");
    assert.equal(body.source, undefined);
    assert.deepEqual(body.properties, { path: "/" });
  });
});
