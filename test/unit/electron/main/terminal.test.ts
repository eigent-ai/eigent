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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handles: new Map<string, (...args: any[]) => any>(),
  listeners: new Map<string, (...args: any[]) => any>(),
  spawn: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      mocks.handles.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      mocks.listeners.set(channel, handler);
    }),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('node-pty', () => ({
  spawn: mocks.spawn,
}));

import {
  disposeAllTerminals,
  registerTerminalIpcHandlers,
  terminalEnvironment,
} from '../../../../electron/main/terminal';

interface FakePty {
  kill: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
}

function fakePty(): FakePty {
  let onData: (data: string) => void = () => {};
  let onExit: (event: { exitCode: number }) => void = () => {};
  return {
    kill: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
    emitData: (data) => onData(data),
    emitExit: (exitCode) => onExit({ exitCode }),
    onData: vi.fn((callback: (data: string) => void) => {
      onData = callback;
    }),
    onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
      onExit = callback;
    }),
  } as FakePty;
}

function sender() {
  return {
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
  };
}

function createHandler() {
  return mocks.handles.get('terminal-create')!;
}

describe('terminal IPC lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    disposeAllTerminals();
    mocks.handles.clear();
    mocks.listeners.clear();
    mocks.spawn.mockReset();
    registerTerminalIpcHandlers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('rejects reattachment of a persisted shell id by another renderer', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const originalSender = sender();
    const reopenedSender = sender();

    await createHandler()(
      { sender: originalSender },
      { id: 'session-shell:project:tab' }
    );
    const result = await createHandler()(
      { sender: reopenedSender },
      { id: 'session-shell:project:tab' }
    );
    pty.emitData('ready');
    vi.runOnlyPendingTimers();

    expect(result).toMatchObject({ success: false });
    expect(originalSender.send).toHaveBeenCalledWith('terminal-data', {
      id: 'session-shell:project:tab',
      data: 'ready',
    });
    expect(reopenedSender.send).not.toHaveBeenCalled();
  });

  it('allows a restored renderer to adopt a shell whose owner was destroyed', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const closedWindowSender = sender();
    const reopenedWindowSender = sender();

    await createHandler()(
      { sender: closedWindowSender },
      { id: 'session-shell:project:restored-tab' }
    );
    closedWindowSender.isDestroyed.mockReturnValue(true);
    const result = await createHandler()(
      { sender: reopenedWindowSender },
      { id: 'session-shell:project:restored-tab' }
    );
    pty.emitData('restored');
    vi.runOnlyPendingTimers();

    expect(result).toMatchObject({ success: true, existing: true });
    expect(closedWindowSender.send).not.toHaveBeenCalled();
    expect(reopenedWindowSender.send).toHaveBeenCalledWith('terminal-data', {
      id: 'session-shell:project:restored-tab',
      data: 'restored',
    });

    const disposed = await mocks.handles.get('terminal-dispose')!(
      { sender: reopenedWindowSender },
      'session-shell:project:restored-tab'
    );
    expect(disposed).toEqual({ success: true });
    expect(pty.kill).toHaveBeenCalledTimes(1);
  });

  it('shares one spawn across concurrent creates for the same id', async () => {
    mocks.spawn.mockReturnValue(fakePty());
    const owner = sender();

    const [first, second] = await Promise.all([
      createHandler()({ sender: owner }, { id: 'shared-shell' }),
      createHandler()({ sender: owner }, { id: 'shared-shell' }),
    ]);

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ success: true });
    expect(second).toMatchObject({ success: true, existing: true });
  });

  it('removes sensitive values from the inherited shell environment', () => {
    expect(
      terminalEnvironment({
        PATH: '/usr/bin',
        LANG: 'en_GB.UTF-8',
        OPENAI_API_KEY: 'secret',
        GH_TOKEN: 'secret',
        AWS_SECRET_ACCESS_KEY: 'secret',
        AWS_ACCESS_KEY_ID: 'secret',
        DATABASE_URL: 'postgres://secret',
        REDIS_URL: 'redis://secret',
        GITHUB_PAT: 'secret',
        NPM_AUTH: 'secret',
        SESSION_COOKIE: 'secret',
        CODEX_RESOLVER_SECRET: 'secret',
        HTTP_PROXY: 'http://user:password@proxy.example',
        HTTPS_PROXY: 'http://user:password@proxy.example',
        ALL_PROXY: 'socks5://user:password@proxy.example',
        NO_PROXY: 'localhost,127.0.0.1',
        XDG_CONFIG_HOME: '/tmp/xdg',
      })
    ).toEqual({
      PATH: '/usr/bin',
      LANG: 'en_GB.UTF-8',
      XDG_CONFIG_HOME: '/tmp/xdg',
    });
  });

  it('batches sustained output before crossing the renderer IPC boundary', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const outputSender = sender();
    await createHandler()({ sender: outputSender }, { id: 'batched-shell' });

    pty.emitData('one');
    pty.emitData('two');
    expect(outputSender.send).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(outputSender.send).toHaveBeenCalledTimes(1);
    expect(outputSender.send).toHaveBeenCalledWith('terminal-data', {
      id: 'batched-shell',
      data: 'onetwo',
    });
  });

  it('rejects input, resize, and disposal from a non-owning renderer', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    const stranger = sender();
    await createHandler()({ sender: owner }, { id: 'owned-shell' });

    mocks.listeners.get('terminal-input')!(
      { sender: stranger },
      { id: 'owned-shell', data: 'unsafe' }
    );
    mocks.listeners.get('terminal-resize')!(
      { sender: stranger },
      { id: 'owned-shell', cols: 100, rows: 40 }
    );
    const rejected = await mocks.handles.get('terminal-dispose')!(
      { sender: stranger },
      'owned-shell'
    );

    expect(pty.write).not.toHaveBeenCalled();
    expect(pty.resize).not.toHaveBeenCalled();
    expect(pty.kill).not.toHaveBeenCalled();
    expect(rejected).toMatchObject({ success: false });

    mocks.listeners.get('terminal-input')!(
      { sender: owner },
      { id: 'owned-shell', data: 'safe' }
    );
    expect(pty.write).toHaveBeenCalledWith('safe');
  });

  it('fails a Project terminal instead of silently falling back to home', async () => {
    mocks.spawn.mockReturnValue(fakePty());
    const result = await createHandler()(
      { sender: sender() },
      {
        id: 'strict-project-shell',
        cwd: '/definitely/missing/eigent-project-directory',
        allowHomeFallback: false,
      }
    );

    expect(result).toMatchObject({
      success: false,
      error: 'Project working directory is unavailable',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('ignores a disposed PTY exit after a replacement shell starts', async () => {
    const oldPty = fakePty();
    const replacementPty = fakePty();
    mocks.spawn.mockReturnValueOnce(oldPty).mockReturnValueOnce(replacementPty);
    const outputSender = sender();

    await createHandler()({ sender: outputSender }, { id: 'restart-shell' });
    await mocks.handles.get('terminal-dispose')!(
      { sender: outputSender },
      'restart-shell'
    );
    await createHandler()({ sender: outputSender }, { id: 'restart-shell' });
    oldPty.emitData('stale output');
    oldPty.emitExit(0);
    vi.runOnlyPendingTimers();

    expect(outputSender.send).not.toHaveBeenCalledWith('terminal-data', {
      id: 'restart-shell',
      data: 'stale output',
    });
    expect(outputSender.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
    replacementPty.emitData('replacement-ready');
    vi.runOnlyPendingTimers();
    expect(outputSender.send).toHaveBeenCalledWith('terminal-data', {
      id: 'restart-shell',
      data: 'replacement-ready',
    });
  });
});
