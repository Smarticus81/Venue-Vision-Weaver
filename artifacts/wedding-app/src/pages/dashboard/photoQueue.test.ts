import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageLabel, groupByCoverage, isAcceptedImageType, planUploads } from "./photoQueue.ts";

const jpg = (name: string) => ({ name, type: "image/jpeg" });

test("planUploads spreads a fresh venue's first five files across the five views", () => {
  const plan = planUploads([jpg("a"), jpg("b"), jpg("c"), jpg("d"), jpg("e")], []);
  assert.deepEqual(
    plan.accepted.map((p) => p.coverage),
    ["exterior", "ceremony", "reception", "detail", "natural_light"],
  );
  assert.equal(plan.rejected.length, 0);
});

test("planUploads fills the missing views first and honours a forced tile", () => {
  const media = [{ coverage: "exterior" }, { coverage: "ceremony" }, { coverage: "reception" }];
  const plan = planUploads([jpg("a"), jpg("b"), jpg("c")], media);
  assert.deepEqual(plan.accepted.map((p) => p.coverage), ["detail", "natural_light", "exterior"]);
  const forced = planUploads([jpg("a"), jpg("b")], media, { forceCoverage: "detail" });
  assert.deepEqual(forced.accepted.map((p) => p.coverage), ["detail", "detail"]);
});

test("planUploads rejects non-images and files past the limits", () => {
  const plan = planUploads([jpg("a"), { name: "doc", type: "application/pdf" }], []);
  assert.equal(plan.accepted.length, 1);
  assert.deepEqual(plan.rejected.map((r) => r.reason), ["type"]);
  const full = planUploads([jpg("a"), jpg("b")], Array.from({ length: 19 }, () => ({ coverage: "detail" })));
  assert.equal(full.accepted.length, 1);
  assert.deepEqual(full.rejected.map((r) => r.reason), ["limit"]);
  const batch = planUploads(Array.from({ length: 12 }, (_, i) => jpg(String(i))), []);
  assert.equal(batch.accepted.length, 10);
  assert.equal(batch.rejected.length, 2);
  const queuedAlready = planUploads([jpg("a")], [], { existingQueued: ["exterior"] });
  assert.equal(queuedAlready.accepted[0].coverage, "ceremony");
});

test("accepted types, labels and grouping", () => {
  assert.equal(isAcceptedImageType("image/heic"), true);
  assert.equal(isAcceptedImageType("image/gif"), false);
  assert.equal(isAcceptedImageType(undefined), false);
  assert.equal(coverageLabel("natural_light"), "Natural light");
  assert.equal(coverageLabel("odd_thing"), "odd thing");
  const groups = groupByCoverage([{ id: 1, coverage: "detail" }, { id: 2, coverage: "detail" }, { id: 3, coverage: "bogus" }]);
  assert.equal(groups.get("detail")!.length, 2);
  assert.equal(groups.get("exterior")!.length, 0);
  assert.equal(groups.size, 5);
});
