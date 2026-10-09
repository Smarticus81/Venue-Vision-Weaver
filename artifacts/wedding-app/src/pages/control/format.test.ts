import assert from "node:assert/strict";
import test from "node:test";
import { barWidth, byUnit, count, delta, hours, money, nearestIndex, pct, ratio, share, sparkGeometry } from "./format";

test("missing values render as a dash, never zero", () => {
  assert.equal(pct(null), "—");
  assert.equal(money(undefined), "—");
  assert.equal(hours(Number.NaN), "—");
  assert.equal(count(null), "—");
  assert.equal(ratio(3, null), "—");
  assert.equal(byUnit(null, "cents"), "—");
});

test("formats rates, money, hours and counts", () => {
  assert.equal(pct(0.042), "4.2%");
  assert.equal(pct(0.0004, 2), "0.04%");
  assert.equal(money(129000), "$1,290");
  assert.equal(money(5950), "$59.50");
  assert.equal(hours(5.25), "5.3 h");
  assert.equal(hours(50), "2.1 d");
  assert.equal(count(1284), "1,284");
  assert.equal(count(12900), "12.9K");
  assert.equal(ratio(3, 41), "3/41");
  assert.equal(share(1, 0), null);
  assert.equal(share(1, 4), 0.25);
});

test("deltas carry direction glyphs and judge good news by direction", () => {
  assert.deepEqual(delta(2, "count"), { text: "+2", glyph: "▲", tone: "good" });
  assert.deepEqual(delta(-12900, "cents"), { text: "−$129", glyph: "▼", tone: "bad" });
  assert.deepEqual(delta(0.01, "rate", "lower"), { text: "+1.00 pts", glyph: "▲", tone: "bad" });
  assert.deepEqual(delta(-1.5, "percent"), { text: "−1.5 pts", glyph: "▼", tone: "bad" });
  assert.equal(delta(0, "count")?.tone, "flat");
  assert.equal(delta(null, "count"), null);
});

test("bar widths and sparkline geometry", () => {
  assert.equal(barWidth(0, 10), 0);
  assert.equal(barWidth(10, 10), 100);
  assert.equal(barWidth(0.01, 100), 2, "non-zero values stay visible");
  assert.equal(barWidth(5, 0), 0);
  const flat = sparkGeometry([3, 3, 3], 100, 20, 0);
  assert.ok(flat.points.every((p) => p.y === 10));
  const rising = sparkGeometry([0, 10], 100, 20, 0);
  assert.equal(rising.points[0]!.y, 20);
  assert.equal(rising.points[1]!.y, 0);
  assert.match(rising.path, /^M0\.0,20\.0 L100\.0,0\.0$/);
  assert.equal(sparkGeometry([], 10, 10).path, "");
  assert.equal(nearestIndex([0, 50, 100], 60), 1);
});
