import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTourCardSvg,
  displayUrl,
  escapeXml,
  extractQrSvg,
  tourCardFileName,
  wrapTitle,
} from "./tourCard.ts";

test("escapeXml neutralises markup in venue names", () => {
  assert.equal(escapeXml(`Willow & "Oak" <House>`), "Willow &amp; &quot;Oak&quot; &lt;House&gt;");
});

test("wrapTitle keeps names to two lines and truncates the rest", () => {
  assert.deepEqual(wrapTitle("The Willow House"), ["The Willow House"]);
  assert.deepEqual(wrapTitle("The Willow House at Oak Creek Farm"), ["The Willow House", "at Oak Creek Farm"]);
  const long = wrapTitle("The Extraordinary Willow House Estate and Gardens of Oak Creek");
  assert.equal(long.length, 2);
  assert.ok(long[1].endsWith("…"));
});

test("buildTourCardSvg embeds the QR, the link and the AI preview label", () => {
  const svg = buildTourCardSvg({
    venueName: "Willow & Oak",
    url: "https://www.dreemer.co/preview/willow-oak",
    qrSvg: '<path d="M0 0h1v1H0z"/>',
    qrViewBox: 29,
  });
  assert.ok(svg.startsWith("<svg "));
  assert.ok(svg.includes("Willow &amp; Oak"));
  assert.ok(svg.includes("www.dreemer.co/preview/willow-oak"));
  assert.ok(svg.includes('<path d="M0 0h1v1H0z"/>'));
  assert.ok(svg.includes("AI preview, imagined at Willow &amp; Oak"));
  assert.ok(!svg.includes("<Willow"));
  assert.match(svg, /scale\(26\.2069\)/);
});

test("file names and display urls are tidy", () => {
  assert.equal(tourCardFileName("willow-oak"), "willow-oak-tour-card.png");
  assert.equal(tourCardFileName("??"), "venue-tour-card.png");
  assert.equal(displayUrl("https://dreemer.co/preview/x/"), "dreemer.co/preview/x");
});

test("extractQrSvg pulls inner markup and the viewBox size", () => {
  const { inner, viewBox } = extractQrSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h33v33H0z"/><path stroke="#000" d="M4 4.5h7"/></svg>',
  );
  assert.equal(viewBox, 33);
  assert.equal(inner, '<path fill="#fff" d="M0 0h33v33H0z"/><path stroke="#000" d="M4 4.5h7"/>');
  assert.equal(extractQrSvg("<svg><g/></svg>").viewBox, 1);
});
