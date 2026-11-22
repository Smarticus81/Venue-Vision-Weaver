/** Scroll-driven motion only: no idle animation loop or scroll interception. */
export function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function experienceChapter(progress: number): 0 | 1 | 2 {
  return Math.min(2, Math.floor(clampProgress(progress) * 3)) as 0 | 1 | 2;
}
