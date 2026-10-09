import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatWeddingMonth,
  galleryStage,
  qualityNote,
  sessionFunnel,
  sourceLabel,
  stageLabel,
  summarizeGalleries,
  upcomingMonths,
} from "./galleryStats.ts";

const base = {
  emailedAt: null,
  firstViewedAt: null,
  viewCount: 0,
  ctaClicks: 0,
  sharedCount: 0,
  bookedAt: null,
};

test("status vocabulary never leaks pipeline words", () => {
  assert.equal(stageLabel(galleryStage("pending")), "Queued");
  assert.equal(stageLabel(galleryStage("processing")), "Rendering");
  assert.equal(stageLabel(galleryStage("ready")), "Ready");
  assert.equal(stageLabel(galleryStage("failed")), "Failed");
  assert.equal(galleryStage("weird"), "queued");
  assert.equal(sourceLabel("tour_day", "couple"), "Tour day");
  assert.equal(sourceLabel("couple_link", "couple"), "Couple link");
  assert.equal(sourceLabel("couple_link", "sample"), "Sample");
});

test("sessionFunnel marks each stage from the summary counters", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const chips = sessionFunnel(
    { ...base, emailedAt: "2026-10-01T10:00:00Z", viewCount: 3, sharedCount: 1, ctaClicks: 1 },
    now,
  );
  assert.deepEqual(
    chips.map((c) => [c.key, c.done]),
    [["sent", true], ["viewed", true], ["clicked", true], ["booked", false]],
  );
  assert.equal(chips[1].detail, "3 views, shared 1");
  assert.equal(chips[2].detail, "1 click");
  assert.equal(chips[0].detail, "Oct 1");
  const fresh = sessionFunnel(base, now);
  assert.ok(fresh.every((c) => !c.done && c.detail === null));
  const viewedByDate = sessionFunnel({ ...base, firstViewedAt: "2026-10-02T00:00:00Z" }, now);
  assert.equal(viewedByDate[1].done, true);
});

test("summarizeGalleries ignores samples and reports a booked rate from two ready galleries", () => {
  const sessions = [
    { ...base, status: "ready", kind: "couple", emailedAt: "x", viewCount: 2, ctaClicks: 1, bookedAt: "2026-09-01" },
    { ...base, status: "ready", kind: "couple", emailedAt: "x", viewCount: 1 },
    { ...base, status: "processing", kind: "couple" },
    { ...base, status: "failed", kind: "couple" },
    { ...base, status: "ready", kind: "sample", viewCount: 9, bookedAt: "2026-09-01" },
  ] as const;
  const s = summarizeGalleries(sessions);
  assert.equal(s.total, 5);
  assert.equal(s.couples, 4);
  assert.equal(s.ready, 2);
  assert.equal(s.inProgress, 1);
  assert.equal(s.failed, 1);
  assert.equal(s.sent, 2);
  assert.equal(s.viewed, 2);
  assert.equal(s.clicked, 1);
  assert.equal(s.booked, 1);
  assert.equal(s.bookedRate, 50);
  assert.equal(summarizeGalleries([sessions[0]]).bookedRate, null);
});

test("wedding months format and list forward from next month", () => {
  assert.equal(formatWeddingMonth("2027-06"), "June 2027");
  assert.equal(formatWeddingMonth("2027-13"), null);
  assert.equal(formatWeddingMonth(""), null);
  const months = upcomingMonths(3, new Date("2026-10-08T00:00:00Z"));
  assert.deepEqual(
    months.map((m) => m.value),
    ["2026-11", "2026-12", "2027-01"],
  );
  assert.equal(months[2].label, "January 2027");
});

test("qualityNote only speaks when the judge flagged the gallery", () => {
  assert.equal(qualityNote(null), null);
  assert.equal(qualityNote({ belowTarget: false, attempts: 3 }), null);
  assert.equal(qualityNote({ belowTarget: true, attempts: 1 }), "Below our quality target after 1 attempt. Preview before sending.");
  assert.equal(qualityNote({ belowTarget: true, attempts: 0 }), "Below our quality target. Preview before sending.");
});
