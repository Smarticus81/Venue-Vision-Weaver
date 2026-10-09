import assert from "node:assert/strict";
import test from "node:test";

// The db package builds a lazy pg Pool at import time; no connection is ever
// opened by these tests, but the module refuses to load without a URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const setup = await import("../lib/venueSetup.js");
const sample = await import("../lib/sampleGallery.js");
const zod = await import("@workspace/api-zod");
const { summarizeSessionQuality } = await import("./sessions.js");

type Session = import("../lib/venueSetup.js").BookableSession & { weddingMonth?: string | null };

const NOW = new Date("2026-10-09T12:00:00Z");
const READY_MEDIA = ["exterior", "ceremony", "reception", "detail", "natural_light"].map((coverage) => ({ coverage }));

/* ————— Request validation (generated zod) ————— */

test("booked body and params follow the generated contract", () => {
  assert.equal(zod.SetSessionBookedBody.safeParse({ booked: true }).success, true);
  assert.equal(zod.SetSessionBookedBody.safeParse({ booked: false }).success, true);
  assert.equal(zod.SetSessionBookedBody.safeParse({}).success, false);
  assert.equal(zod.SetSessionBookedBody.safeParse({ booked: "yes" }).success, false);
  const params = zod.SetSessionBookedParams.safeParse({ slug: "the-barn", id: "42" });
  assert.equal(params.success, true);
  assert.equal(params.success && params.data.id, 42);
  assert.equal(zod.SetSessionBookedParams.safeParse({ slug: "the-barn", id: "abc" }).success, false);
});

test("import body accepts an empty object or a websiteUrl string only", () => {
  assert.equal(zod.ImportVenueWebsiteMediaBody.safeParse({}).success, true);
  assert.equal(zod.ImportVenueWebsiteMediaBody.safeParse({ websiteUrl: "thebarn.com" }).success, true);
  assert.equal(zod.ImportVenueWebsiteMediaBody.safeParse({ websiteUrl: 42 }).success, false);
});

test("update venue body carries incentiveText (max 160) and reviewBeforeSend", () => {
  const ok = zod.UpdateVenueBody.safeParse({ incentiveText: "Book by June and the rehearsal room is on us.", reviewBeforeSend: true });
  assert.equal(ok.success, true);
  assert.equal(ok.success && ok.data.reviewBeforeSend, true);
  assert.equal(zod.UpdateVenueBody.safeParse({ incentiveText: null }).success, true);
  assert.equal(zod.UpdateVenueBody.safeParse({ incentiveText: "x".repeat(161) }).success, false);
  assert.equal(zod.UpdateVenueBody.safeParse({ reviewBeforeSend: "true" }).success, false);
});

test("normalizeIncentiveText flattens to one trimmed line and clears empties", () => {
  assert.equal(setup.normalizeIncentiveText("  Book by June \n and the room\tis on us  "), "Book by June and the room is on us");
  assert.equal(setup.normalizeIncentiveText("   "), null);
  assert.equal(setup.normalizeIncentiveText(null), null);
  assert.equal(setup.normalizeIncentiveText("a\u0000b c"), "a b c");
  assert.equal(setup.normalizeIncentiveText("y".repeat(200))?.length, setup.INCENTIVE_TEXT_MAX);
});

/* ————— Booked toggle ————— */

function memoryBookedStore(initial: Session) {
  let row: Session = { ...initial };
  const events: Array<{ eventType: string; actor: string }> = [];
  let writes = 0;
  const store: import("../lib/venueSetup.js").BookedStore<Session> = {
    async loadSession(venueId, sessionId) {
      return row.venueId === venueId && row.id === sessionId ? { ...row } : null;
    },
    async writeBooked(_sessionId, change) {
      writes += 1;
      const wantsBooked = change.bookedAt != null;
      if (wantsBooked === (row.bookedAt != null)) return null; // conditional write lost
      row = { ...row, bookedAt: change.bookedAt, bookedBy: change.bookedBy };
      return { ...row };
    },
    async recordEvent(_session, eventType, actor) {
      events.push({ eventType, actor });
    },
  };
  return { store, events, get row() { return row; }, get writes() { return writes; } };
}

const coupleSession: Session = { id: 7, venueId: 3, kind: "couple", bookedAt: null, bookedBy: null };

test("marking booked stamps booked_at/booked_by and records one booked event", async () => {
  const mem = memoryBookedStore(coupleSession);
  const out = await setup.setSessionBooked(mem.store, { venueId: 3, sessionId: 7, booked: true, actor: "owner:user_1", now: NOW });
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.changed, true);
  assert.deepEqual(mem.row.bookedAt, NOW);
  assert.equal(mem.row.bookedBy, "owner:user_1");
  assert.deepEqual(mem.events, [{ eventType: "booked", actor: "owner:user_1" }]);
});

test("booked toggle is idempotent: repeating it writes nothing and records no event", async () => {
  const mem = memoryBookedStore({ ...coupleSession, bookedAt: NOW, bookedBy: "owner:user_1" });
  const again = await setup.setSessionBooked(mem.store, { venueId: 3, sessionId: 7, booked: true, actor: "owner:user_2", now: NOW });
  assert.equal(again.ok && again.changed, false);
  assert.equal(mem.writes, 0);
  assert.equal(mem.events.length, 0);
  assert.equal(mem.row.bookedBy, "owner:user_1", "the first marker is kept");

  const unbook = await setup.setSessionBooked(mem.store, { venueId: 3, sessionId: 7, booked: false, actor: "owner:user_2", now: NOW });
  assert.equal(unbook.ok && unbook.changed, true);
  assert.equal(mem.row.bookedAt, null);
  assert.equal(mem.row.bookedBy, null);
  const unbookAgain = await setup.setSessionBooked(mem.store, { venueId: 3, sessionId: 7, booked: false, actor: "owner:user_2", now: NOW });
  assert.equal(unbookAgain.ok && unbookAgain.changed, false);
  assert.deepEqual(mem.events.map((e) => e.eventType), ["unbooked"]);
});

test("a lost conditional write answers with the current row and no second event", async () => {
  const mem = memoryBookedStore(coupleSession);
  const racing: import("../lib/venueSetup.js").BookedStore<Session> = {
    ...mem.store,
    async writeBooked() {
      // Another request booked it between the read and the write.
      await mem.store.writeBooked(7, { bookedAt: NOW, bookedBy: "owner:other" });
      return null;
    },
  };
  const out = await setup.setSessionBooked(racing, { venueId: 3, sessionId: 7, booked: true, actor: "owner:user_1", now: NOW });
  assert.equal(out.ok && out.changed, false);
  assert.equal(out.ok && out.session.bookedBy, "owner:other");
  assert.equal(mem.events.length, 0);
});

test("sample sessions cannot be booked and unknown sessions are 404", async () => {
  const mem = memoryBookedStore({ ...coupleSession, kind: "sample" });
  const refused = await setup.setSessionBooked(mem.store, { venueId: 3, sessionId: 7, booked: true, actor: "owner:u", now: NOW });
  assert.deepEqual(refused.ok ? null : [refused.status, refused.code], [409, "sample_session"]);
  const missing = await setup.setSessionBooked(mem.store, { venueId: 4, sessionId: 7, booked: true, actor: "owner:u", now: NOW });
  assert.deepEqual(missing.ok ? null : missing.status, 404);
});

test("ownerActor matches the booked_by convention", () => {
  assert.equal(setup.ownerActor("user_abc"), "owner:user_abc");
});

/* ————— Tour card ————— */

test("tour card: first download stamps and logs once; repeats keep the first timestamp", async () => {
  let stampedAt: Date | null = null;
  const logged: number[] = [];
  const store: import("../lib/venueSetup.js").TourCardStore<{ id: number; tourCardDownloadedAt: Date | null }> = {
    async stampFirstDownload(venueId, now) {
      if (stampedAt) return null;
      stampedAt = now;
      return { id: venueId, tourCardDownloadedAt: now };
    },
    async reload(venueId) {
      return { id: venueId, tourCardDownloadedAt: stampedAt };
    },
    async recordFirstDownload(venue) {
      logged.push(venue.id);
    },
  };
  const first = await setup.markTourCardDownloaded(store, 5, NOW);
  assert.equal(first?.firstTime, true);
  const later = await setup.markTourCardDownloaded(store, 5, new Date(NOW.getTime() + 60_000));
  assert.equal(later?.firstTime, false);
  assert.deepEqual(later?.venue.tourCardDownloadedAt, NOW);
  assert.deepEqual(logged, [5]);
});

/* ————— Website import request ————— */

test("planWebsiteImport validates the URL and the cooldown before anything is fetched", () => {
  const base = { venueWebsiteUrl: null, websiteImportedAt: null, now: NOW };
  const none = setup.planWebsiteImport(base);
  assert.deepEqual(none.ok ? null : [none.status, none.code], [400, "no_website_url"]);

  const bad = setup.planWebsiteImport({ ...base, websiteUrlOverride: "ftp://example.com" });
  assert.deepEqual(bad.ok ? null : [bad.status, bad.code], [400, "invalid_website_url"]);

  const saved = setup.planWebsiteImport({ ...base, venueWebsiteUrl: "thebarn.com" });
  assert.deepEqual(saved.ok ? [saved.websiteUrl, saved.override] : null, ["https://thebarn.com/", false]);

  const override = setup.planWebsiteImport({ ...base, venueWebsiteUrl: "old.com", websiteUrlOverride: " https://new.example/weddings " });
  assert.deepEqual(override.ok ? [override.websiteUrl, override.override] : null, ["https://new.example/weddings", true]);

  const cooling = setup.planWebsiteImport({
    ...base,
    venueWebsiteUrl: "thebarn.com",
    websiteImportedAt: new Date(NOW.getTime() - 60_000),
  });
  assert.deepEqual(cooling.ok ? null : [cooling.status, cooling.code], [429, "import_cooldown"]);

  const cooled = setup.planWebsiteImport({
    ...base,
    venueWebsiteUrl: "thebarn.com",
    websiteImportedAt: new Date(NOW.getTime() - 11 * 60_000),
  });
  assert.equal(cooled.ok, true);
});

test("appendDisplayOrders continues after the highest existing order", () => {
  assert.deepEqual(setup.appendDisplayOrders([], 3), [0, 1, 2]);
  assert.deepEqual(setup.appendDisplayOrders([0, 4, 2], 2), [5, 6]);
  assert.deepEqual(setup.appendDisplayOrders([1], 0), []);
});

/* ————— Sample gallery ————— */

function sampleDeps(overrides: Partial<import("../lib/venueSetup.js").SampleGalleryDeps<{ id: number }>> = {}) {
  const calls: string[] = [];
  const deps: import("../lib/venueSetup.js").SampleGalleryDeps<{ id: number }> = {
    async loadMedia() {
      calls.push("loadMedia");
      return READY_MEDIA;
    },
    async countSamples() {
      calls.push("countSamples");
      return { inFlight: 0, nonFailed: 0 };
    },
    async canSpend() {
      return { ok: true as const };
    },
    async countOrgSampleStarts() {
      return 0;
    },
    async preparePhotos() {
      calls.push("preparePhotos");
      return { ok: true, objectKeys: ["/objects/uploads/a", "/objects/uploads/b"] };
    },
    async insertSession(_venueId, objectKeys) {
      calls.push(`insert:${objectKeys.length}`);
      return { ok: true, session: { id: 99 } };
    },
    async discardPhotos(objectKeys) {
      calls.push(`discard:${objectKeys.length}`);
    },
    ...overrides,
  };
  return { deps, calls };
}

test("sample gallery answers 409 demo_not_configured when the server has no demo couple photos", async () => {
  const outcome = await sample.prepareSamplePhotos({
    findPhotos: async () => null,
    read: async () => Buffer.alloc(0),
    store: async () => "/objects/uploads/never",
  });
  assert.equal(outcome.ok, false);
  assert.equal(!outcome.ok && outcome.status, 409);
  assert.equal(!outcome.ok && outcome.code, "demo_not_configured");

  const { deps, calls } = sampleDeps({ preparePhotos: () => sample.prepareSamplePhotos({
    findPhotos: async () => [{ path: "/tmp/only-one.jpg", contentType: "image/jpeg" }],
    read: async () => Buffer.from("x"),
    store: async () => "/objects/uploads/never",
  }) });
  const started = await setup.startSampleGallery(deps, 3);
  assert.deepEqual(started.ok ? null : [started.status, started.code], [409, "demo_not_configured"]);
  assert.ok(!calls.some((call) => call.startsWith("insert")), "no session row without demo photos");
});

test("sample gallery refuses before copying photos when the venue is not ready, busy or at its limit", async () => {
  const notReady = sampleDeps({ loadMedia: async () => READY_MEDIA.slice(0, 3) });
  const a = await setup.startSampleGallery(notReady.deps, 3);
  assert.deepEqual(a.ok ? null : a.code, "venue_not_ready");
  assert.ok(!notReady.calls.includes("preparePhotos"));

  const busy = sampleDeps({ countSamples: async () => ({ inFlight: 1, nonFailed: 1 }) });
  const b = await setup.startSampleGallery(busy.deps, 3);
  assert.deepEqual(b.ok ? null : b.code, "sample_in_progress");

  const full = sampleDeps({ countSamples: async () => ({ inFlight: 0, nonFailed: setup.MAX_SAMPLES_PER_VENUE }) });
  const c = await setup.startSampleGallery(full.deps, 3);
  assert.deepEqual(c.ok ? null : c.code, "sample_limit");
  assert.ok(!full.calls.includes("preparePhotos"));
});

test("sample gallery inserts once photos are copied, and discards them when the locked re-check refuses", async () => {
  const happy = sampleDeps();
  const ok = await setup.startSampleGallery(happy.deps, 3);
  assert.deepEqual(ok.ok ? ok.session : null, { id: 99 });
  assert.deepEqual(happy.calls, ["loadMedia", "countSamples", "preparePhotos", "insert:2"]);

  const raced = sampleDeps({
    insertSession: async () => ({ ok: false, status: 409, error: "busy", code: "sample_in_progress" }),
  });
  const refused = await setup.startSampleGallery(raced.deps, 3);
  assert.equal(refused.ok, false);
  assert.ok(raced.calls.includes("discard:2"));
});

test("a sample needs a fundable account and counts against a lifetime per-organization allowance", async () => {
  const expired = sampleDeps({ canSpend: async () => ({ ok: false, reason: "trial_expired" }) });
  const a = await setup.startSampleGallery(expired.deps, 3);
  assert.deepEqual(a.ok ? null : [a.status, a.code], [402, "trial_expired"]);
  assert.ok(!expired.calls.includes("preparePhotos"), "no provider spend without a fundable account");

  const broke = sampleDeps({ canSpend: async () => ({ ok: false, reason: "insufficient_credits" }) });
  const b = await setup.startSampleGallery(broke.deps, 3);
  assert.deepEqual(b.ok ? null : [b.status, b.code], [402, "insufficient_credits"]);

  // Deleting a sample or failing one never frees a slot: starts are counted
  // from a persistent log, not from live non-failed rows.
  const used = sampleDeps({ countOrgSampleStarts: async () => setup.MAX_SAMPLE_STARTS_PER_ORG });
  const c = await setup.startSampleGallery(used.deps, 3);
  assert.deepEqual(c.ok ? null : [c.status, c.code], [409, "sample_org_limit"]);
  assert.ok(!used.calls.includes("preparePhotos"));
});

/* ————— Owner quality summary ————— */

test("summarizeSessionQuality flags below-target or unjudged stills and counts attempts", () => {
  assert.equal(summarizeSessionQuality([], 0), null);
  assert.deepEqual(
    summarizeSessionQuality(
      [
        { assetType: "image", qualityReport: { judgeStatus: "passed" } },
        { assetType: "video", qualityReport: null },
      ],
      4,
    ),
    { belowTarget: false, attempts: 4 },
  );
  assert.deepEqual(
    summarizeSessionQuality([{ assetType: "image", qualityReport: { judgeStatus: "below_target" } }], 6),
    { belowTarget: true, attempts: 6 },
  );
  assert.deepEqual(
    summarizeSessionQuality([{ assetType: "image", qualityReport: { judgeStatus: "unjudged" } }], 0),
    { belowTarget: true, attempts: 0 },
  );
});
