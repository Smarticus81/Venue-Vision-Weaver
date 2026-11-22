import assert from "node:assert/strict";
import test from "node:test";
import { clampProgress, experienceChapter } from "./lensMotion";

test("lens progress stays finite and bounded", () => {
  for (const [input, expected] of [[-4, 0], [0.5, 0.5], [8, 1], [NaN, 0], [Infinity, 0]]) {
    assert.equal(clampProgress(input), expected);
  }
});
test("experience has three stable chapters, including scroll endpoints", () => {
  assert.deepEqual([-1, 0, .32, .34, .65, .67, 1, 4].map(experienceChapter), [0, 0, 0, 1, 1, 2, 2, 2]);
});
