/**
 * The descent — waypoint data for the scroll-driven camera flight from
 * high aerial down to the altar threshold. Three-free module: the page
 * reads the labels, the scene builds vectors from the coordinates.
 */

export type JourneyWaypoint = {
  progress: number;
  pos: [number, number, number];
  look: [number, number, number];
  elevFt: number;
  state: string;
};

export const JOURNEY_WAYPOINTS: JourneyWaypoint[] = [
  { progress: 0.0, pos: [0, 48, 85], look: [0, 10, -20], elevFt: 12400, state: "Aerial flight" },
  { progress: 0.3, pos: [-15, 26, 45], look: [0, 6, -10], elevFt: 11100, state: "Descent through mist" },
  { progress: 0.65, pos: [8, 12, 22], look: [0, 3, -4], elevFt: 9950, state: "Valley approach" },
  { progress: 1.0, pos: [0, 2.4, 9.5], look: [0, 1.2, -3], elevFt: 9800, state: "Altar threshold" },
];

/** Linearly interpolated elevation readout, e.g. "11,845 FT". */
export function journeyElevation(progress: number): string {
  const p = Math.min(1, Math.max(0, progress));
  let a = JOURNEY_WAYPOINTS[0];
  let b = JOURNEY_WAYPOINTS[JOURNEY_WAYPOINTS.length - 1];
  for (let i = 0; i < JOURNEY_WAYPOINTS.length - 1; i++) {
    if (p >= JOURNEY_WAYPOINTS[i].progress && p <= JOURNEY_WAYPOINTS[i + 1].progress) {
      a = JOURNEY_WAYPOINTS[i];
      b = JOURNEY_WAYPOINTS[i + 1];
      break;
    }
  }
  const range = b.progress - a.progress;
  const f = range === 0 ? 0 : (p - a.progress) / range;
  const ft = Math.round((a.elevFt + (b.elevFt - a.elevFt) * f) / 10) * 10;
  return `${ft.toLocaleString("en-US")} FT`;
}

/** Journey progress past which the scene unlocks into explore mode. */
export const ARRIVAL_THRESHOLD = 0.94;

/** HUD metadata for the most recent waypoint the flight has reached.
 * The final stage reads as reached once the arrival unlock fires. */
export function journeyStage(progress: number): { state: string } {
  for (let i = JOURNEY_WAYPOINTS.length - 1; i > 0; i--) {
    const reachedAt =
      i === JOURNEY_WAYPOINTS.length - 1
        ? ARRIVAL_THRESHOLD
        : JOURNEY_WAYPOINTS[i].progress - 0.001;
    if (progress >= reachedAt) return JOURNEY_WAYPOINTS[i];
  }
  return JOURNEY_WAYPOINTS[0];
}
