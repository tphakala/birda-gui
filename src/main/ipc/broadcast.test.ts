import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipc, resetIpc } from '../test-support/ipc-harness';

vi.mock('electron', async () => (await import('../test-support/ipc-harness')).electronMock);

const { sendToWindows } = await import('./broadcast');

beforeEach(() => {
  resetIpc();
});

describe('sendToWindows', () => {
  it('sends to every open window and skips a destroyed one', () => {
    ipc.windows = [{ destroyed: false }, { destroyed: true }, { destroyed: false }];
    sendToWindows('birda:analysis-progress', { n: 1 });
    expect(ipc.sent).toEqual([
      { window: 0, channel: 'birda:analysis-progress', payload: { n: 1 } },
      { window: 2, channel: 'birda:analysis-progress', payload: { n: 1 } },
    ]);
  });
});
