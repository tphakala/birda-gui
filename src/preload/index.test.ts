import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ api: null as null | Record<string, (...args: never[]) => unknown> }));

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    contextBridge: {
      exposeInMainWorld: (_key: string, api: Record<string, (...args: never[]) => unknown>) => {
        h.api = api;
      },
    },
    ipcRenderer: Object.assign(new Emitter(), { invoke: vi.fn() }),
  };
});

await import('./index');
const { ipcRenderer } = (await import('electron')) as unknown as { ipcRenderer: EventEmitter };

type On = (channel: string, callback: (...args: unknown[]) => void) => () => void;
const on = (...args: Parameters<On>) => (h.api?.on as unknown as On)(...args);
const invoke = (...args: unknown[]) => (h.api?.invoke as unknown as (...a: unknown[]) => Promise<unknown>)(...args);

describe('window.birda.on', () => {
  it('returns an unsubscribe that removes only its own listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = on('birda:analysis-progress', first);
    on('birda:analysis-progress', second);

    offFirst();
    ipcRenderer.emit('birda:analysis-progress', {}, 'payload');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('payload');
  });

  it('refuses a channel that is not allowlisted', () => {
    expect(() => on('not:allowed', vi.fn())).toThrow('IPC receive channel not allowed');
  });
});

describe('window.birda.invoke', () => {
  const failWith = (message: string) => {
    vi.mocked((ipcRenderer as unknown as { invoke: () => Promise<unknown> }).invoke).mockRejectedValueOnce(
      new Error(message),
    );
  };

  it("strips Electron's remote method prefix from a handler's error", async () => {
    failWith("Error invoking remote method 'birda:analyze': Error: Analysis failed: birda exited with code 1");
    await expect(invoke('birda:analyze', {})).rejects.toThrow(/^Analysis failed: birda exited with code 1$/);
  });

  it('leaves an error without the prefix alone', async () => {
    failWith('plain failure');
    await expect(invoke('birda:analyze', {})).rejects.toThrow(/^plain failure$/);
  });
});

describe('allowlists', () => {
  // Every channel the renderer's wrappers use must be allowlisted, or the call
  // is refused at runtime; read both from source, since the lists are private.
  const read = (file: string) => readFileSync(resolve(import.meta.dirname, file), 'utf8');
  const preload = read('index.ts');
  const wrappers = read('../renderer/src/lib/utils/ipc.ts') + read('../renderer/src/lib/utils/shortcuts.ts');
  const listed = (name: string) => {
    const block = new RegExp(`${name} = new Set\\(\\[([^\\]]*)\\]`).exec(preload)?.[1] ?? '';
    return new Set([...block.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  };
  const used = (method: string) =>
    [...wrappers.matchAll(new RegExp(`window\\.birda\\.${method}\\(\\s*'([^']+)'`, 'g'))].map((m) => m[1]);

  it('allow every channel the renderer invokes', () => {
    const allowed = listed('ALLOWED_INVOKE_CHANNELS');
    expect(used('invoke').length).toBeGreaterThan(0);
    expect(used('invoke').filter((c) => !allowed.has(c))).toEqual([]);
  });

  it('allow every channel the renderer listens on', () => {
    const allowed = listed('ALLOWED_RECEIVE_CHANNELS');
    expect(used('on').length).toBeGreaterThan(0);
    expect(used('on').filter((c) => !allowed.has(c))).toEqual([]);
  });
});
