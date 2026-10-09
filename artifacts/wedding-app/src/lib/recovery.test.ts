import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COUPLE_DRAFT_TTL_MS,
  clearCoupleDraft,
  clearLegacyGalleryStorage,
  loadCoupleDraft,
  requestRecoveryEmail,
  resumableStep,
  saveCoupleDraft,
} from "./recovery.ts";
import { DEFAULT_STYLE_ID, initialStyleId, orderStyles, styleSample } from "./styleSamples.ts";
import type { KeyValueStore } from "./shareSession.ts";

function memoryStore(): KeyValueStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const draft = {
  step: 3,
  styleId: "heirloom-memory",
  coupleName: "Ana & Sam",
  coupleEmail: "ana@example.com",
  weddingMonth: "2027-06",
};

describe("couple draft", () => {
  it("round-trips per venue", () => {
    const store = memoryStore();
    saveCoupleDraft(store, "willow", draft, 1_000);
    assert.deepEqual(loadCoupleDraft(store, "willow", 2_000), draft);
    assert.equal(loadCoupleDraft(store, "other", 2_000), null);
  });

  it("expires after the TTL and removes the stale entry", () => {
    const store = memoryStore();
    saveCoupleDraft(store, "willow", draft, 0);
    assert.equal(loadCoupleDraft(store, "willow", COUPLE_DRAFT_TTL_MS + 1), null);
    assert.equal(store.map.size, 0);
  });

  it("sanitises tampered values", () => {
    const store = memoryStore();
    store.setItem(
      "dreemer:couple-draft:willow",
      JSON.stringify({ v: 1, savedAt: 0, step: 9, styleId: 5, coupleName: "x".repeat(200), coupleEmail: null, weddingMonth: "June" }),
    );
    assert.deepEqual(loadCoupleDraft(store, "willow", 1), {
      step: 1,
      styleId: null,
      coupleName: "x".repeat(80),
      coupleEmail: "",
      weddingMonth: "",
    });
  });

  it("clears, and tolerates missing or throwing storage", () => {
    const store = memoryStore();
    saveCoupleDraft(store, "willow", draft, 0);
    clearCoupleDraft(store, "willow");
    assert.equal(store.map.size, 0);
    assert.equal(loadCoupleDraft(null, "willow", 0), null);
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    assert.doesNotThrow(() => saveCoupleDraft(throwing, "willow", draft, 0));
    assert.equal(loadCoupleDraft(throwing, "willow", 0), null);
    assert.doesNotThrow(() => clearLegacyGalleryStorage(throwing, throwing));
  });

  it("reopens on the photo step when the photos are gone", () => {
    assert.equal(resumableStep(draft, 0, 2), 2);
    assert.equal(resumableStep(draft, 2, 2), 3);
    assert.equal(resumableStep({ ...draft, step: 2 }, 0, 2), 2);
    assert.equal(resumableStep(null, 0, 2), 1);
  });
});

describe("legacy storage", () => {
  it("removes both legacy gallery lists", () => {
    const local = memoryStore();
    const session = memoryStore();
    local.setItem("wedding-saved-sessions", "[]");
    session.setItem("dreemer-my-sessions", "[]");
    session.setItem("keep", "1");
    clearLegacyGalleryStorage(local, session);
    assert.equal(local.map.size, 0);
    assert.deepEqual([...session.map.keys()], ["keep"]);
  });
});

describe("requestRecoveryEmail", () => {
  it("normalises the address and reports acceptance", async () => {
    let body = "";
    const result = await requestRecoveryEmail("  Ana@Example.com ", async (_input, init) => {
      body = String(init.body);
      return { ok: true, json: async () => ({ accepted: true }) };
    });
    assert.deepEqual(result, { accepted: true });
    assert.deepEqual(JSON.parse(body), { email: "ana@example.com" });
  });

  it("surfaces server and network errors", async () => {
    assert.deepEqual(
      await requestRecoveryEmail("a@b.co", async () => ({ ok: false, json: async () => ({ error: "Slow down" }) })),
      { accepted: false, error: "Slow down" },
    );
    assert.equal(
      (
        await requestRecoveryEmail("a@b.co", async () => {
          throw new Error("offline");
        })
      ).error,
      "Network error. Try again.",
    );
    assert.equal((await requestRecoveryEmail("  ")).accepted, false);
  });
});

describe("style samples", () => {
  const styles = [
    { id: "golden-hour-dream" },
    { id: "cinematic-editorial" },
    { id: "heirloom-memory" },
  ];

  it("puts the default first and preselects it", () => {
    assert.deepEqual(orderStyles(styles).map((s) => s.id), ["cinematic-editorial", "golden-hour-dream", "heirloom-memory"]);
    assert.equal(initialStyleId(styles, null), DEFAULT_STYLE_ID);
    assert.equal(initialStyleId(styles, "heirloom-memory"), "heirloom-memory");
    assert.equal(initialStyleId(styles, "retired-style"), DEFAULT_STYLE_ID);
    assert.equal(initialStyleId([{ id: "only" }], null), "only");
    assert.equal(initialStyleId([], null), null);
  });

  it("has a committed sample for each server style", () => {
    for (const { id } of styles) {
      const sample = styleSample(id);
      assert.ok(sample, id);
      assert.equal(sample.src, `/brand/styles/${id}.webp`);
    }
    assert.equal(styleSample("unknown"), null);
  });
});
