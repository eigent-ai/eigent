// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSessionWindowRole,
  initSessionWindows,
  onSessionWindowMessage,
  openSessionWindow,
  parseSessionWindowPath,
  postSessionWindowMessage,
  sessionWindowPath,
} from '../../../src/lib/sessionWindows';

const target = { spaceId: 'space 1', projectId: 'project/a' };

describe('Session window routes', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('round-trips a Session through its window path', () => {
    const path = sessionWindowPath(target);
    expect(path).toBe('/session-window/space%201/project%2Fa');
    expect(parseSessionWindowPath(path)).toEqual(target);
  });

  it('rejects paths that are not exactly one Session', () => {
    expect(parseSessionWindowPath('/')).toBeNull();
    expect(parseSessionWindowPath('/session-window/space')).toBeNull();
    expect(parseSessionWindowPath('/session-window/a/b/c')).toBeNull();
    expect(parseSessionWindowPath('/session-window/%E0%A4%A/b')).toBeNull();
  });

  it('reads the role from the desktop hash route', () => {
    expect(getSessionWindowRole()).toBe('main');
    window.location.hash = '#/session-window/space/project';
    expect(getSessionWindowRole()).toBe('session');
  });
});

describe('Session window messages on desktop', () => {
  it('relays through the main process and drops malformed messages', async () => {
    const handlers: Array<(event: unknown, message: unknown) => void> = [];
    const ipcRenderer = {
      send: vi.fn(),
      invoke: vi.fn().mockResolvedValue({ success: true }),
      on: vi.fn((_channel: string, handler: (e: unknown, m: unknown) => void) =>
        handlers.push(handler)
      ),
      off: vi.fn(),
    };
    initSessionWindows({ electronAPI: {}, ipcRenderer });

    const received = vi.fn();
    const stop = onSessionWindowMessage(received);
    // A second subscriber shares the single transport listener.
    const other = vi.fn();
    onSessionWindowMessage(other);
    expect(ipcRenderer.on).toHaveBeenCalledOnce();

    postSessionWindowMessage({ type: 'opened', ...target });
    expect(ipcRenderer.send).toHaveBeenCalledWith('session-window:post', {
      type: 'opened',
      ...target,
    });

    const deliver = (message: unknown) =>
      handlers.forEach((handler) => handler({}, message));
    deliver({ type: 'closed', ...target });
    deliver({ type: 'closed', spaceId: 1 });
    deliver({ type: 'session-control', action: 'drop-table', ...target });
    deliver({ type: 'nav-lead', kind: 'running', spin: true, ...target });
    deliver({ type: 'nav-lead', kind: 'nope', ...target });
    expect(received.mock.calls.map(([message]) => message.type)).toEqual([
      'closed',
      'nav-lead',
    ]);

    stop();
    deliver({ type: 'who-is-open' });
    expect(received).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(3);

    await openSessionWindow(target);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'session-window:open',
      target
    );
  });
});
