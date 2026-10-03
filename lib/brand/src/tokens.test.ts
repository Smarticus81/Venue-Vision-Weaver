import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastRatio } from "./contrast.js";
import { coral, ink, ivory, sea, semantic, success, warning, error, cssText } from "./tokens.js";

const AA_TEXT = 4.5;
const AA_LARGE = 3;

const textOnSurfaces: Array<[string, string]> = [
  ["text", semantic.text],
  ["textSecondary", semantic.textSecondary],
  ["textMuted", semantic.textMuted],
  ["accentText", semantic.accentText],
  ["secondary", semantic.secondary],
  ["successText", success.text],
  ["warningText", warning.text],
  ["errorText", error.text],
];

for (const surface of [semantic.canvas, semantic.surface, semantic.surfaceRaised, ivory[0]]) {
  for (const [name, fg] of textOnSurfaces) {
    test(`${name} ${fg} reads at AA on ${surface}`, () => {
      assert.ok(contrastRatio(fg, surface) >= AA_TEXT, `${contrastRatio(fg, surface).toFixed(2)}:1`);
    });
  }
}

test("placeholder text reaches AA on raised and card surfaces", () => {
  assert.ok(contrastRatio(semantic.textPlaceholder, semantic.surfaceRaised) >= AA_TEXT);
  assert.ok(contrastRatio(semantic.textPlaceholder, semantic.surface) >= AA_TEXT);
});

test("ink text on the coral primary action is AA", () => {
  assert.ok(contrastRatio(semantic.textOnAccent, semantic.accent) >= AA_TEXT);
  assert.ok(contrastRatio(semantic.textOnAccent, semantic.accentHover) >= AA_TEXT);
});

test("ivory text on ink surfaces is AA", () => {
  assert.ok(contrastRatio(semantic.inkText, semantic.inkSurface) >= AA_TEXT);
  assert.ok(contrastRatio(semantic.inkTextMuted, semantic.inkSurface) >= AA_TEXT);
  assert.ok(contrastRatio(coral[400], semantic.inkSurface) >= AA_TEXT, "coral on ink (reversed lockup, links on dark)");
});

test("soft tints keep their text colors readable", () => {
  assert.ok(contrastRatio(success.text, success.soft) >= AA_TEXT);
  assert.ok(contrastRatio(warning.text, warning.soft) >= AA_TEXT);
  assert.ok(contrastRatio(error.text, error.soft) >= AA_TEXT);
  assert.ok(contrastRatio(coral[700], coral[50]) >= AA_TEXT);
  assert.ok(contrastRatio(sea[700], sea[50]) >= AA_TEXT);
});

test("white text on status fills is at least AA-large (fills carry icons and short labels)", () => {
  assert.ok(contrastRatio(ivory[0], error.fill) >= AA_TEXT);
  assert.ok(contrastRatio(ivory[0], success.fill) >= AA_TEXT);
  assert.ok(contrastRatio(ink[900], warning.fill) >= AA_TEXT);
});

test("focus ring is visible against every surface (3:1 non-text)", () => {
  for (const surface of [semantic.canvas, semantic.surface, semantic.surfaceRaised, ivory[0]]) {
    assert.ok(contrastRatio(semantic.focusRing, surface) >= AA_LARGE, surface);
  }
});

test("generated css contains the brand anchors", () => {
  const css = cssText();
  assert.match(css, /--dm-coral-500: #F07B64;/);
  assert.match(css, /--dm-ink-900: #061219;/);
  assert.match(css, /--dm-ivory-200: #E9E6DB;/);
});
