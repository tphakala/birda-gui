import { displayZone, parseStoredInstant, type ClockZone } from '$shared/time-zone';

/**
 * The clock a detection is read in: the recording start plus the detection's
 * offset into the file, in the run's zone, else in the file's stored offset
 * (always the stored offset for a file whose start came from an AudioMoth
 * header). Null when the recording has no usable start.
 */
export function detectionClock(
  recordingStart: unknown,
  startTime: unknown,
  runTimezone: unknown,
  fileOffsetMin: unknown,
  timestampSource: unknown,
): { ms: number; zone: ClockZone } | null {
  const start = parseStoredInstant(typeof recordingStart === 'string' ? recordingStart : null);
  if (start === null) return null;
  const zone = displayZone(
    typeof runTimezone === 'string' ? runTimezone : null,
    typeof fileOffsetMin === 'number' ? fileOffsetMin : null,
    timestampSource === 'header' ? 'header' : null,
  );
  return { ms: start + Number(startTime) * 1000, zone };
}
