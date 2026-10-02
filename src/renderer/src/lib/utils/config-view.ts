/** One line of the birda config shown as a list; a null value means the setting is not set. */
export interface ConfigEntry {
  key: string;
  value: string | null;
}

/** Text of a config value: floats rounded to 7 significant digits (birda stores f32 widened to f64). */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return String(Number(value.toPrecision(7)));
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.map(formatValue).filter((v): v is string => v !== null);
    return items.length > 0 ? items.join(', ') : null;
  }
  return JSON.stringify(value);
}

/** Flattens the nested config into dotted keys (defaults.min_confidence) with readable values. */
export function flattenConfig(config: Record<string, unknown>, prefix = ''): ConfigEntry[] {
  const entries: ConfigEntry[] = [];
  for (const [name, value] of Object.entries(config)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = flattenConfig(value as Record<string, unknown>, key);
      if (nested.length > 0) entries.push(...nested);
      else entries.push({ key, value: null });
    } else {
      entries.push({ key, value: formatValue(value) });
    }
  }
  return entries;
}
