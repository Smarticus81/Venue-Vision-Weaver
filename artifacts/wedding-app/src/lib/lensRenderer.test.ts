import assert from "node:assert/strict";
import test from "node:test";
import { mountLens } from "./lensRenderer";

for (const preference of ["prefers-reduced-motion", "pointer: coarse"]) {
  test(`lens skips GPU work for ${preference}`, async () => {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) => ({ matches: query.includes(preference) })) as typeof matchMedia;
    let contextRequested = false;
    try {
      const canvas = { getContext() { contextRequested = true; return null; } } as unknown as HTMLCanvasElement;
      assert.equal(await mountLens(canvas), null);
      assert.equal(contextRequested, false);
    } finally { globalThis.matchMedia = original; }
  });
}

test("unavailable WebGL keeps the static image fallback", async () => {
  const original = globalThis.matchMedia;
  globalThis.matchMedia = (() => ({ matches: false })) as typeof matchMedia;
  try {
    const canvas = { getContext() { return null; } } as unknown as HTMLCanvasElement;
    assert.equal(await mountLens(canvas), null);
  } finally { globalThis.matchMedia = original; }
});
