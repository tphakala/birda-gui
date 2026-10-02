import { getPosition } from 'suncalc';
import { zonedWallToUtc, type ClockZone } from '$shared/time-zone';

export type SunPhase = 'night' | 'twilight' | 'daylight';

export interface SunPhaseGradient {
  fromPhase: SunPhase;
  toPhase: SunPhase;
  /** 0-1 fraction of the hour where transition occurs (0 = start, 1 = end) */
  at: number;
}

interface HourlySunPhase {
  hour: number;
  phase: SunPhase;
  /** Present when a phase transition occurs within this hour */
  gradient?: SunPhaseGradient;
}

function altitudeDeg(date: Date, latitude: number, longitude: number): number {
  return getPosition(date, latitude, longitude).altitude;
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
 * Hours match the heatmap columns, which come from detection_hour() in the
 * catalog (src/main/db/database.ts). They are in the run's clock, the zone given
 * here, except for files whose start came from an AudioMoth header: those are
 * in their own offset.
 *
 * @param day        Calendar day in the zone's clock.
 * @param latitude   Recording location latitude.
 * @param longitude  Recording location longitude.
 * @param zone       The zone the hours are in (IANA name or fixed offset). Each hour is
 *                   converted to UTC at that day's offset, so a DST change is followed.
 */
export function computeHourlySunPhases(
  day: { year: number; month: number; day: number },
  latitude: number,
  longitude: number,
  zone: ClockZone,
): HourlySunPhase[] {
  const at = (hour: number, minute: number, second: number): number =>
    zonedWallToUtc({ ...day, hour, minute, second }, zone).instantMs;

  const result: HourlySunPhase[] = [];
  for (let h = 0; h < 24; h++) {
    // Midpoint of the hour in the run's clock, converted to UTC for suncalc
    const midAlt = altitudeDeg(new Date(at(h, 30, 0)), latitude, longitude);
    const phase = classifyAltitude(midAlt);

    // Check start and end of hour to detect transitions
    const startUtc = at(h, 0, 0);
    const endUtc = at(h, 59, 59);
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
        at: hi / 60, // fraction of hour (0-1)
      };
    }

    const entry: HourlySunPhase = { hour: h, phase };
    if (gradient) entry.gradient = gradient;
    result.push(entry);
  }

  return result;
}
