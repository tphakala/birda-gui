#!/usr/bin/env node
/**
 * Fails when the compiled Paraglide output is missing a message from
 * messages/en.json. paraglide-js 2.25.1 compile exits 0 when it cannot load the
 * inlang plugins (measured offline with no project.inlang/cache) and writes an
 * output with no messages; this turns that into a hard error.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** @type {unknown} */
const catalog = JSON.parse(readFileSync(join(root, 'messages', 'en.json'), 'utf8'));
const keys = Object.keys(/** @type {object} */ (catalog)).filter((key) => !key.startsWith('$'));

/** @type {unknown} */
const compiled = await import(pathToFileURL(join(root, 'src/renderer/src/paraglide/messages/_index.js')).href);
const exports = /** @type {Record<string, unknown>} */ (compiled);
const missing = keys.filter((key) => typeof exports[key] !== 'function');

if (missing.length > 0) {
  console.error(
    `Paraglide output is missing ${String(missing.length)} of ${String(keys.length)} messages ` +
      `(first: ${missing.slice(0, 3).join(', ')}). The inlang plugins may have failed to load; ` +
      'check the network or project.inlang/cache and compile again.',
  );
  process.exit(1);
}
