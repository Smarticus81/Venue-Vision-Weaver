import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStorageObjectPath,
  objectKeyFileName,
  ownerAssetUrl,
  venueReferenceUrl,
  withQueryParam,
} from "./storageUrls.ts";

test("normalizeStorageObjectPath routes every key shape through the storage proxy", () => {
  assert.equal(normalizeStorageObjectPath(""), "");
  assert.equal(normalizeStorageObjectPath("data:image/png;base64,AAA"), "data:image/png;base64,AAA");
  assert.equal(normalizeStorageObjectPath("/api/storage/objects/x.jpg"), "/api/storage/objects/x.jpg");
  assert.equal(
    normalizeStorageObjectPath("https://bucket.example/uploads/abc-123?sig=1"),
    "/api/storage/objects/uploads/abc-123",
  );
  assert.equal(normalizeStorageObjectPath("/objects/venue/1.jpg"), "/api/storage/objects/venue/1.jpg");
  assert.equal(normalizeStorageObjectPath("objects/venue/1.jpg"), "/api/storage/objects/venue/1.jpg");
  assert.equal(normalizeStorageObjectPath("//venue/1.jpg"), "/api/storage/objects/venue/1.jpg");
});

test("venueReferenceUrl attaches the slug and withQueryParam appends correctly", () => {
  assert.equal(venueReferenceUrl("objects/v/1.jpg", "willow"), "/api/storage/objects/v/1.jpg?venueSlug=willow");
  assert.equal(withQueryParam("/a?x=1", "y", "2 3"), "/a?x=1&y=2%203");
  assert.equal(withQueryParam("/a", "y", ""), "/a");
  assert.equal(ownerAssetUrl("objects/g/thumb.webp"), "/api/storage/objects/g/thumb.webp");
});

test("objectKeyFileName keeps an extension or adds one", () => {
  assert.equal(objectKeyFileName("objects/uploads/abc.webp"), "abc.webp");
  assert.equal(objectKeyFileName("objects/uploads/abc"), "abc.jpg");
  assert.equal(objectKeyFileName(""), "venue-photo.jpg");
});
