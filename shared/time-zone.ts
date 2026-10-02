/**
 * Time zone arithmetic on top of Intl only (no dependency). A zone is an IANA
 * name ('UTC' included) or a fixed offset in minutes east of UTC. Fixed
 * offsets are computed arithmetically rather than through Intl offset zone
 * strings such as '+03:00', whose support depends on the Node version.
 */
export type ClockZone = string | { offsetMin: number };

export interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall clock reading of an instant (epoch ms) in a zone. */
export function wallClockAt(ms: number, zone: ClockZone): Wall {
  if (typeof zone !== 'string') {
    const d = new Date(ms + zone.offsetMin * 60_000);
    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
  const out: Wall = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatterFor(zone).formatToParts(new Date(ms))) {
    if (part.type in out) out[part.type as keyof Wall] = Number(part.value);
  }
  return out;
}

function wallToNaive(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** Offset of a zone at an instant, in minutes east of UTC. */
export function offsetAt(ms: number, zone: ClockZone): number {
  if (typeof zone !== 'string') return zone.offsetMin;
  const whole = Math.floor(ms / 1000) * 1000;
  return Math.round((wallToNaive(wallClockAt(whole, zone)) - whole) / 60_000);
}

function sameWall(a: Wall, b: Wall): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

/**
 * Instant of a wall clock reading in a zone. A reading that occurs twice (the
 * clock goes back) resolves to the earlier occurrence; one that does not exist
 * (the clock jumps forward) is read with the offset in force before the gap,
 * so it lands just after the gap. The returned offset is the zone's actual
 * offset at the resulting instant.
 */
export function zonedWallToUtc(w: Wall, zone: ClockZone): { instantMs: number; offsetMin: number } {
  const naive = wallToNaive(w);
  if (typeof zone !== 'string') return { instantMs: naive - zone.offsetMin * 60_000, offsetMin: zone.offsetMin };
  // Anchor first: sampling around the naive value alone fails for +12h zones.
  const t0 = naive - offsetAt(naive, zone) * 60_000;
  const before = offsetAt(t0 - 6 * 3_600_000, zone);
  const after = offsetAt(t0 + 6 * 3_600_000, zone);
  const hits = [...new Set([before, after])]
    .map((o) => naive - o * 60_000)
    .filter((t) => sameWall(wallClockAt(t, zone), w));
  const instantMs = hits.length ? Math.min(...hits) : naive - before * 60_000;
  return { instantMs, offsetMin: offsetAt(instantMs, zone) };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/** ISO 8601 text of an instant written in a fixed offset: "...T05:30:00+03:00" or "...Z". */
export function formatIsoWithOffset(ms: number, offsetMin: number): string {
  const w = wallClockAt(ms, { offsetMin });
  const local = `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}`;
  if (offsetMin === 0) return `${local}Z`;
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${local}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * Epoch ms of a stored timestamp. Zone-less "YYYY-MM-DD HH:MM:SS" (or with a
 * T) is read as UTC, the way SQLite datetime() reads it. Null for null or
 * anything unparseable.
 */
export function parseStoredInstant(s: string | null): number | null {
  if (!s) return null;
  const text = s.trim();
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const iso = text.replace(' ', 'T');
  const ms = Date.parse(zoned ? iso : `${iso}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Label of a fixed offset: "UTC", "UTC+03:00", "UTC-05:30". */
export function offsetLabel(offsetMin: number): string {
  if (offsetMin === 0) return 'UTC';
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function isValidTimeZone(tz: string): boolean {
  if (tz === 'UTC') return true;
  if (tz === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Zone names that ICU still lists under their old CLDR spelling, mapped to the
 * current IANA name. Intl accepts both spellings, so a stored legacy name keeps
 * working; this only decides what is shown and saved.
 */
export const LEGACY_ZONE_NAMES: ReadonlyMap<string, string> = new Map([
  ['Africa/Asmera', 'Africa/Asmara'],
  ['America/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
  ['America/Catamarca', 'America/Argentina/Catamarca'],
  ['America/Coral_Harbour', 'America/Atikokan'],
  ['America/Cordoba', 'America/Argentina/Cordoba'],
  ['America/Godthab', 'America/Nuuk'],
  ['America/Indianapolis', 'America/Indiana/Indianapolis'],
  ['America/Jujuy', 'America/Argentina/Jujuy'],
  ['America/Louisville', 'America/Kentucky/Louisville'],
  ['America/Mendoza', 'America/Argentina/Mendoza'],
  ['Asia/Calcutta', 'Asia/Kolkata'],
  ['Asia/Katmandu', 'Asia/Kathmandu'],
  ['Asia/Rangoon', 'Asia/Yangon'],
  ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
  ['Atlantic/Faeroe', 'Atlantic/Faroe'],
  ['Europe/Kiev', 'Europe/Kyiv'],
  ['Pacific/Enderbury', 'Pacific/Kanton'],
  ['Pacific/Ponape', 'Pacific/Pohnpei'],
  ['Pacific/Truk', 'Pacific/Chuuk'],
]);

/** The current name of a zone: a legacy spelling is mapped, anything else is returned as is. */
export function currentZoneName(zone: string): string {
  return LEGACY_ZONE_NAMES.get(zone) ?? zone;
}

/** Every zone Intl knows, under current names, sorted and without duplicates. */
export function listTimeZones(): string[] {
  return [...new Set(Intl.supportedValuesOf('timeZone').map(currentZoneName))].sort();
}

/** The machine's IANA zone, falling back to UTC when it cannot be resolved. */
export function systemTimeZone(): string {
  try {
    const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? currentZoneName(tz) : 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Zone a file's times are shown in: the run's own zone, else the offset stored
 * on the file (an AudioMoth header, or UTC when there is none). A file whose
 * start came from an AudioMoth header always uses its own offset, since the
 * run's zone is the zone of file name timestamps.
 */
export function displayZone(
  runTz: string | null,
  fileOffsetMin: number | null,
  timestampSource: 'header' | 'filename' | null = null,
): ClockZone {
  return (timestampSource === 'header' ? null : runTz) ?? { offsetMin: fileOffsetMin ?? 0 };
}

/** A calendar day in a zone's clock. */
export interface ClockDay {
  year: number;
  month: number;
  day: number;
  zone: ClockZone;
}

/**
 * "YYYY-MM-DD|zone" of an instant, the zone being the IANA name or the offset
 * label. A zero offset and the IANA zone UTC key alike.
 */
export function clockDayKey(ms: number, zone: ClockZone): string {
  const w = wallClockAt(ms, zone);
  const label = typeof zone === 'string' ? zone : offsetLabel(zone.offsetMin);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}|${label}`;
}

/** Inverse of offsetLabel for the offset forms ("UTC+03:00"); other text is an IANA name. */
function parseZoneLabel(label: string): ClockZone {
  const m = /^UTC([+-])(\d\d):(\d\d)$/.exec(label);
  if (!m) return label;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return { offsetMin: m[1] === '-' ? -minutes : minutes };
}

/** The one day and zone that clockDayKey values share, or null for none or several. */
export function sharedClockDay(keys: readonly string[]): ClockDay | null {
  const distinct = [...new Set(keys)];
  if (distinct.length !== 1) return null;
  const m = /^(\d{4})-(\d\d)-(\d\d)\|(.+)$/.exec(distinct[0] ?? '');
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), zone: parseZoneLabel(m[4]) };
}
