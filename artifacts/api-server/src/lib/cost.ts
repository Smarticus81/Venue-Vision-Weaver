// Gallery economics:
//   - 4 generated stills, then a local branded motion reel stitched from them.
const GALLERY_STILL_COUNT = 4;
const GALLERY_STILL_COST_USD = 0.039;

export function estimateSessionCostUsd(): number {
  return +(GALLERY_STILL_COUNT * GALLERY_STILL_COST_USD).toFixed(2);
}
