import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

// An inline script is only allowed by the Content Security Policy when its
// sha256 is listed in script-src. Reformatting the script silently breaks that,
// so recompute the hash of every inline script and compare.
const html = readFileSync(resolve(__dirname, '../../src/renderer/index.html'), 'utf8');

function cspScriptSrc(): string {
  const meta = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
  if (!meta) throw new Error('no CSP meta tag in index.html');
  const directive = meta[1].split(';').find((d) => d.trim().startsWith('script-src'));
  if (!directive) throw new Error('no script-src directive in CSP');
  return directive;
}

function inlineScripts(): string[] {
  const scripts: string[] = [];
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (!/\ssrc=/.test(m[1])) scripts.push(m[2]);
  }
  return scripts;
}

describe('renderer index.html CSP', () => {
  it('has at least one inline script to check', () => {
    expect(inlineScripts().length).toBeGreaterThan(0);
  });

  it.each(inlineScripts().map((s, i) => [i, s] as const))('allows inline script #%i by hash', (_i, script) => {
    const hash = createHash('sha256').update(script).digest('base64');
    expect(cspScriptSrc()).toContain(`'sha256-${hash}'`);
  });
});
