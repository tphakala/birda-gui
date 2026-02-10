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
 * Compute the dominant sun phase for each hour of a given date and location.
 * Uses the midpoint of each hour (e.g., 06:30 for the 06 column) to determine phase.
 *
 * For hours where the sun phase changes (sunrise/sunset transitions), a `gradient`
 * field is included with the from/to phases and the fractional position of the transition.
 *
 * Hours match the heatmap columns produced by computeDetectionHour() in catalog.ts,
 * which are in the recording's timezone (whatever timezone the filename uses).
 *
 * @param date            Recording start Date (from parseRecordingStart — local JS Date).
 * @param latitude        Recording location latitude.
 * @param longitude       Recording location longitude.
 * @param timezoneOffsetMin  UTC offset in minutes of the recording's timezone (e.g., 180 for UTC+3).
 *                           Defaults to 0 (UTC) when unknown. This converts heatmap "filename hours"
 *                           to real UTC times for accurate sun position calculation.
 */
export function computeHourlySunPhases(
  date: Date,
  latitude: number,
  longitude: number,
  timezoneOffsetMin = 0,
): HourlySunPhase[] {
  // Use local accessors to extract the date components that match the original filename,
  // since parseRecordingStart() creates dates via `new Date(y, m, d, h, mi, s)` (local time).
  const y = date.getFullYear();
  const m = date.getMonth();
  const d = date.getDate();

  // Offset in milliseconds: subtract from Date.UTC values to convert
  // "recording timezone time" → "actual UTC time" for suncalc.
  const offsetMs = timezoneOffsetMin * 60_000;

  const result: HourlySunPhase[] = [];
  for (let h = 0; h < 24; h++) {
    // Midpoint of the hour in the recording's timezone, converted to UTC for suncalc
    const midpointUtc = Date.UTC(y, m, d, h, 30, 0) - offsetMs;
    const midAlt = altitudeDeg(new Date(midpointUtc), latitude, longitude);
    const phase = classifyAltitude(midAlt);

    // Check start and end of hour to detect transitions
    const startUtc = Date.UTC(y, m, d, h, 0, 0) - offsetMs;
    const endUtc = Date.UTC(y, m, d, h, 59, 59) - offsetMs;
    const startPhase = classifyAltitude(altitudeDeg(new Date(startUtc), latitude, longitude));
    const endPhase = classifyAltitude(altitudeDeg(new Date(endUtc), latitude, longitude));

    let gradient: SunPhaseGradient | undefined;

    if (startPhase !== endPhase) {
      // Binary search for the transition point (to ~1 minute precision)
      let lo = 0; // minutes from start of hour
      let hi = 59;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const t = new Date(startUtc + mid * 60_000);
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
