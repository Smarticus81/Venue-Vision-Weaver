import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import sharp from "sharp";
import { buildKenBurnsSlideshow, ffmpegExecutable } from "./motionReel.js";

const exec = promisify(execFile);

/** Geometric fixtures only: no customer photos, AI calls, mail or storage. */
async function fixture(width: number, height: number, color: string): Promise<Buffer> {
  const lines = Array.from({ length: 40 }, (_, i) =>
    `<path d="M0 ${i * height / 40} L${width} ${height - i * height / 40}" stroke="#f7f8fc" stroke-width="3"/>`,
  ).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${color}"/>${lines}
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 4}" fill="#c6c4fa"/>
    <rect x="10%" y="70%" width="20%" height="20%" fill="#000000"/>
    <rect x="70%" y="70%" width="20%" height="20%" fill="#ffffff"/>
  </svg>`)).png().toBuffer();
}

function topLevelBoxes(buffer: Buffer): string[] {
  const boxes: string[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    assert.ok(offset + 8 <= buffer.length, "complete MP4 box header");
    let size = buffer.readUInt32BE(offset);
    let headerSize = 8;
    if (size === 1) {
      assert.ok(offset + 16 <= buffer.length, "complete extended MP4 box header");
      size = Number(buffer.readBigUInt64BE(offset + 8));
      headerSize = 16;
    } else if (size === 0) size = buffer.length - offset;
    assert.ok(Number.isSafeInteger(size) && size >= headerSize && offset + size <= buffer.length, "valid MP4 box boundary");
    boxes.push(buffer.toString("ascii", offset + 4, offset + 8));
    offset += size;
  }
  return boxes;
}

test("production reel encodes and fully decodes with mobile-compatible timing and fast-start metadata", { timeout: 120_000 }, async (t) => {
  const ffmpeg = ffmpegExecutable();
  const ffprobe = process.env.FFPROBE_PATH?.trim()
    || (path.isAbsolute(ffmpeg) ? path.join(path.dirname(ffmpeg), process.platform === "win32" ? "ffprobe.exe" : "ffprobe") : "ffprobe");
  // Intentionally fail, not skip, if the integration environment lacks binaries.
  await exec(ffmpeg, ["-version"]);
  await exec(ffprobe, ["-version"]);
  const dir = await mkdtemp(path.join(os.tmpdir(), "dreemer-reel-integration-"));
  try {
    const slides = await Promise.all([
      fixture(1280, 720, "#202a44"),
      fixture(600, 800, "#5351a2"),
      fixture(800, 800, "#36486a"),
    ]);
    const hashes = slides.map((slide) => createHash("sha256").update(slide).digest("hex"));
    const start = performance.now();
    const reel = await buildKenBurnsSlideshow(slides, 1, { venueName: "Synthetic Reel QA" });
    t.diagnostic(`encodeMs=${Math.round(performance.now() - start)} bytes=${reel.length}`);
    assert.deepEqual(slides.map((slide) => createHash("sha256").update(slide).digest("hex")), hashes);
    const boxes = topLevelBoxes(reel);
    assert.equal(boxes[0], "ftyp");
    assert.ok(boxes.indexOf("moov") > 0 && boxes.indexOf("moov") < boxes.indexOf("mdat"), "fast-start metadata precedes video data");
    const file = path.join(dir, "reel.mp4");
    await writeFile(file, reel);
    const probe = await exec(ffprobe, [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,codec_tag_string,pix_fmt,color_range,width,height,sample_aspect_ratio,avg_frame_rate,nb_read_frames:format=duration:frame=best_effort_timestamp_time",
      "-of", "json", file,
    ], { maxBuffer: 2 * 1024 * 1024, timeout: 30_000 });
    const data = JSON.parse(probe.stdout);
    assert.equal(data.streams.length, 1);
    const stream = data.streams[0];
    assert.equal(stream.codec_name, "h264");
    assert.equal(stream.codec_tag_string, "avc1");
    assert.equal(stream.pix_fmt, "yuv420p");
    assert.equal(stream.color_range, "tv");
    assert.equal(stream.width, 1280);
    assert.equal(stream.height, 720);
    assert.equal(stream.sample_aspect_ratio, "1:1");
    assert.equal(stream.avg_frame_rate, "30/1");
    assert.equal(Number(stream.nb_read_frames), 120, "three stills plus the title card, each exactly one second");
    assert.ok(Math.abs(Number(data.format.duration) - 4) < 0.04);
    assert.equal(data.frames.length, 120);
    data.frames.forEach((frame: { best_effort_timestamp_time: string }, index: number) => {
      assert.ok(Math.abs(Number(frame.best_effort_timestamp_time) - index / 30) < 0.00001, `continuous presentation timestamp at frame ${index}`);
    });
    // Decode the entire reel, including every concatenation boundary. ffprobe
    // metadata alone would not detect a damaged or undecodable video stream.
    await exec(ffmpeg, ["-v", "error", "-xerror", "-err_detect", "explode", "-i", file, "-f", "null", "-"], { timeout: 30_000 });
    // Check actual decoded colors, not only range flags. Merely relabeling
    // full-range samples as limited-range would change this known color.
    for (const sample of [
      { x: 640, y: 360, rgb: [198, 196, 250] },
      { x: 256, y: 576, rgb: [0, 0, 0] },
      { x: 1024, y: 576, rgb: [255, 255, 255] },
    ]) {
      const pixel = await exec(ffmpeg, [
        "-v", "error", "-ss", "1.5", "-i", file, "-frames:v", "1",
        "-vf", `format=rgb24,crop=1:1:${sample.x}:${sample.y}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
      ], { encoding: "buffer", timeout: 30_000 });
      assert.equal(pixel.stdout.length, 3);
      sample.rgb.forEach((expected, channel) => {
        assert.ok(Math.abs(pixel.stdout[channel]! - expected) <= 8, `decoded fixture at ${sample.x},${sample.y}, channel ${channel}`);
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
