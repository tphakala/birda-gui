import { getPosition } from 'suncalc';

export type SunPhase = 'night' | 'twilight' | 'daylight';

export interface SunPhaseGradient {
  fromPhase: SunPhase;
  toPhase: SunPhase;
  /** 0–1 fraction of the hour where transition occurs (0 = start, 1 = end) */
  at: number;
}

interface HourlySunPhase {
  hour: number;
  phase: SunPhase;
  /** Present when a phase transition occurs within this hour */
  gradient?: SunPhaseGradient;
}

const RAD_TO_DEG = 180 / Math.PI;

function altitudeDeg(date: Date, latitude: number, longitude: number): number {
  return getPosition(date, latitude, longitude).altitude * RAD_TO_DEG;
}

/** Classify by sun altitude: >= 0° daylight, >= -6° twilight (civil), < -6° night. */
function classifyAltitude(altDeg: number): SunPhase {
  if (altDeg >= 0) return 'daylight';
  if (altDeg >= -6) return 'twilight';
  return 'night';
}

/**
 * Compute the dominant sun phase for each UTC hour of a given date and location.
 * Uses the midpoint of each hour (e.g., 06:30 UTC for the 06 column) to determine phase.
 *
 * For hours where the sun phase changes (sunrise/sunset transitions), a `gradient`
 * field is included with the from/to phases and the fractional position of the transition.
 *
 * Hours are UTC to match the heatmap data produced by computeDetectionHour() in catalog.ts.
 */
export function computeHourlySunPhases(date: Date, latitude: number, longitude: number): HourlySunPhase[] {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();

  const result: HourlySunPhase[] = [];
  for (let h = 0; h < 24; h++) {
    // Midpoint of the hour in UTC — determines the dominant phase
    const midpoint = new Date(Date.UTC(y, m, d, h, 30, 0));
    const midAlt = altitudeDeg(midpoint, latitude, longitude);
    const phase = classifyAltitude(midAlt);

    // Check start and end of hour to detect transitions
    const startTime = Date.UTC(y, m, d, h, 0, 0);
    const endTime = Date.UTC(y, m, d, h, 59, 59);
    const startPhase = classifyAltitude(altitudeDeg(new Date(startTime), latitude, longitude));
    const endPhase = classifyAltitude(altitudeDeg(new Date(endTime), latitude, longitude));

    let gradient: SunPhaseGradient | undefined;

    if (startPhase !== endPhase) {
      // Binary search for the transition point (to ~1 minute precision)
      let lo = 0; // minutes from start of hour
      let hi = 59;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const t = new Date(startTime + mid * 60_000);
        const p = classifyAltitude(altitudeDeg(t, latitude, longitude));
        if (p === startPhase) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      gradient = {
        fromPhase: startPhase,
        toPhase: endPhase,
        at: hi / 60, // fraction of hour (0–1)
      };
    }

    const entry: HourlySunPhase = { hour: h, phase };
    if (gradient) entry.gradient = gradient;
    result.push(entry);
  }

  return result;
}
