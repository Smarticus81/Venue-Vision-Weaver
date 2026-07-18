import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { parseByteRange } from "./byteRange.js";
import { ObjectStorageService } from "./objectStorage.js";

test("parses the small probe range used by mobile video players", () => {
  assert.deepEqual(parseByteRange("bytes=0-1", 4096), { start: 0, end: 1 });
});

test("parses open-ended and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=1024-", 4096), { start: 1024, end: 4095 });
  assert.deepEqual(parseByteRange("bytes=-512", 4096), { start: 3584, end: 4095 });
});

test("clamps ranges and rejects unsatisfiable or multiple ranges", () => {
  assert.deepEqual(parseByteRange("bytes=4000-9999", 4096), { start: 4000, end: 4095 });
  assert.equal(parseByteRange("bytes=4096-", 4096), null);
  assert.equal(parseByteRange("bytes=0-1,4-5", 4096), null);
});

test("serves a video probe as a partial 206 response", async () => {
  const buffer = Buffer.from("0123456789");
  const file = {
    download: async (): Promise<[Buffer]> => [buffer],
    getMetadata: async () => ({ contentType: "video/mp4", size: buffer.length }),
    createReadStream: async (range?: { start?: number; end?: number }) =>
      Readable.from(buffer.subarray(range?.start ?? 0, (range?.end ?? buffer.length - 1) + 1)),
  };

  const response = await new ObjectStorageService().downloadObject(
    file,
    3600,
    "/objects/uploads/reel.mp4",
    "bytes=0-1",
  );

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-range"), "bytes 0-1/10");
  assert.equal(response.headers.get("content-length"), "2");
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(await response.text(), "01");
});
