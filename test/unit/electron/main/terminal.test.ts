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

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    disposeAllTerminals();
    mocks.handles.clear();
    mocks.listeners.clear();
    mocks.spawn.mockReset();
    registerTerminalIpcHandlers();
  });

  it('refreshes the output sender when a persisted shell id is reattached', async () => {
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

    expect(result).toMatchObject({ success: true, existing: true });
    expect(originalSender.send).not.toHaveBeenCalled();
    expect(reopenedSender.send).toHaveBeenCalledWith('terminal-data', {
      id: 'session-shell:project:tab',
      data: 'ready',
    });
  });

  it('shares one spawn across concurrent creates for the same id', async () => {
    mocks.spawn.mockReturnValue(fakePty());
    const firstSender = sender();
    const secondSender = sender();

    const [first, second] = await Promise.all([
      createHandler()({ sender: firstSender }, { id: 'shared-shell' }),
      createHandler()({ sender: secondSender }, { id: 'shared-shell' }),
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
        CODEX_RESOLVER_SECRET: 'secret',
      })
    ).toEqual({
      PATH: '/usr/bin',
      LANG: 'en_GB.UTF-8',
    });
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

    expect(outputSender.send).not.toHaveBeenCalledWith('terminal-data', {
      id: 'restart-shell',
      data: 'stale output',
    });
    expect(outputSender.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
    replacementPty.emitData('replacement-ready');
    expect(outputSender.send).toHaveBeenCalledWith('terminal-data', {
      id: 'restart-shell',
      data: 'replacement-ready',
    });
  });
});
