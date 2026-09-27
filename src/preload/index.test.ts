import { EventEmitter } from 'node:events';
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
