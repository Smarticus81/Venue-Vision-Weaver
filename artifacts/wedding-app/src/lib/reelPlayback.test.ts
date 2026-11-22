import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MotionReel } from "../components/gallery/MotionReel.tsx";
import { playReel, shouldAutoplayReel } from "./reelPlayback.ts";

test("reduced motion and data saving each disable reel autoplay", () => {
  assert.equal(shouldAutoplayReel({ reducedMotion: false, saveData: false }), true);
  for (const preferences of [
    { reducedMotion: true, saveData: false },
    { reducedMotion: false, saveData: true },
    { reducedMotion: true, saveData: true },
  ]) assert.equal(shouldAutoplayReel(preferences), false);
});

test("playback waits for the browser and handles permission, interruption and media errors", async () => {
  assert.equal(await playReel({ play: async () => {} }), "playing");
  for (const name of ["NotAllowedError", "AbortError"]) {
    assert.equal(await playReel({ play: async () => { throw { name }; } }), "paused");
  }
  assert.equal(await playReel({ play: async () => { throw { name: "NotSupportedError" }; } }), "error");
});

test("server markup offers native inline controls, a poster and a touch play button without forcing autoplay", () => {
  const html = renderToStaticMarkup(createElement(MotionReel, { src: "/reel.mp4", poster: "/poster.webp", venueName: "Willow" }));
  assert.match(html, /playsInline=""/);
  assert.match(html, /controls=""/);
  assert.match(html, /muted=""/);
  assert.match(html, /poster="\/poster.webp"/);
  assert.match(html, /width="1280" height="720"/);
  assert.match(html, /preload="none"/);
  assert.match(html, />Play reel<\/button>/);
  assert.doesNotMatch(html, /autoPlay/i);
});
