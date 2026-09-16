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
  killTree: vi.fn(),
  execFile: vi.fn(),
  procPidInfo: vi.fn(),
  processes: new Map<number, { parentPid: number; birth: bigint }>(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
  default: { execFile: mocks.execFile },
}));
vi.mock('koffi', () => ({
  default: {
    load: () => ({ func: () => mocks.procPidInfo }),
    errno: () => 3,
  },
}));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const mocked = {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      const match = /^\/proc\/(\d+)\/stat$/.exec(String(args[0]));
      if (!match) return actual.readFileSync(...args);
      const state = mocks.processes.get(Number(match[1]));
      if (!state) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      return `${match[1]} (test process) S ${state.parentPid} ${Array(17).fill('0').join(' ')} ${state.birth}`;
    },
  };
  return { ...mocked, default: mocked };
});

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

vi.mock('tree-kill', () => ({ default: mocks.killTree }));

vi.mock('node-pty', () => ({
  spawn: mocks.spawn,
}));

type TerminalModule = typeof import('../../../../electron/main/terminal');
let disposeAllTerminals: TerminalModule['disposeAllTerminals'];
let registerTerminalIpcHandlers: TerminalModule['registerTerminalIpcHandlers'];
let terminalEnvironment: TerminalModule['terminalEnvironment'];

interface FakePty {
  kill: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  emitData: (data: string) => void;
  emitExit: (exitCode: number) => void;
}

const fixturePtys = new Set<FakePty>();

function fakePty(pid = 12345): FakePty {
  const birth = mocks.processes.get(pid)?.birth;
  let onData: (data: string) => void = () => {};
  const exitListeners = new Set<(event: { exitCode: number }) => void>();
  const pty = {
    pid,
    kill: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
    emitData: (data) => onData(data),
    emitExit: (exitCode) => {
      if (mocks.processes.get(pid)?.birth === birth)
        mocks.processes.delete(pid);
      [...exitListeners].forEach((callback) => callback({ exitCode }));
    },
    onData: vi.fn((callback: (data: string) => void) => {
      onData = callback;
    }),
    onExit: vi.fn((callback: (event: { exitCode: number }) => void) => {
      exitListeners.add(callback);
      return { dispose: () => exitListeners.delete(callback) };
    }),
  } as FakePty;
  fixturePtys.add(pty);
  return pty;
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

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;

const describePlatform = describe.each(['darwin', 'linux']);
describePlatform('terminal IPC lifecycle (%s)', (platform) => {
  afterEach(async () => {
    mocks.processes.clear();
    fixturePtys.forEach((pty) => pty.emitExit(0));
    const cleanup = disposeAllTerminals();
    if (vi.isFakeTimers()) await vi.runAllTimersAsync();
    await cleanup;
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', originalPlatform);
  });

  beforeEach(async () => {
    // Each test gets its own session registry and app-shutdown gate. Finish
    // asynchronous cleanup before restoring any process/IPC mocks.
    vi.resetModules();
    ({ disposeAllTerminals, registerTerminalIpcHandlers, terminalEnvironment } =
      await import('../../../../electron/main/terminal'));
    Object.defineProperty(process, 'platform', { value: platform });
    fixturePtys.clear();
    mocks.handles.clear();
    mocks.listeners.clear();
    mocks.spawn.mockReset();
    mocks.killTree.mockReset();
    mocks.processes.clear();
    mocks.processes.set(12345, { parentPid: process.pid, birth: 1000n });
    mocks.procPidInfo.mockImplementation((pid, _flavor, _arg, info) => {
      const state = mocks.processes.get(pid);
      if (!state) return 0;
      info.writeUInt32LE(state.parentPid, 16);
      info.writeBigUInt64LE(1n, 120);
      info.writeBigUInt64LE(state.birth, 128);
      return 136;
    });
    mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
      callback(
        null,
        [...mocks.processes]
          .map(([pid, state]) => `${pid} ${state.parentPid}`)
          .join('\n')
      );
    });
    vi.spyOn(process, 'kill').mockReturnValue(true);
    registerTerminalIpcHandlers();
  });

  it('stops only the owning renderer terminal tree and waits for exit', async () => {
    vi.useFakeTimers();
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'stop-test' });
    const stop = mocks.handles.get('terminal-stop')!;
    expect(await stop({ sender: sender() }, 'stop-test')).toMatchObject({
      success: false,
    });
    expect(process.kill).not.toHaveBeenCalled();
    let settled = false;
    const first = stop({ sender: owner }, 'stop-test').then((value) => {
      settled = true;
      return value;
    });
    const second = stop({ sender: owner }, 'stop-test');
    await vi.advanceTimersByTimeAsync(0);
    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1499);
    expect(process.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(process.kill).toHaveBeenLastCalledWith(12345, 'SIGKILL');
    pty.emitExit(137);
    await vi.advanceTimersByTimeAsync(100);
    expect(await first).toEqual({ success: true });
    expect(await second).toEqual({ success: true });
    expect(await stop({ sender: owner }, 'stop-test')).toEqual({
      success: true,
    });
  });

  it('reports stop failures and permits another stop attempt', async () => {
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'stop-failure' });
    vi.mocked(process.kill).mockImplementation(() => {
      throw new Error('denied');
    });
    const stop = mocks.handles.get('terminal-stop')!;
    expect(await stop({ sender: owner }, 'stop-failure')).toMatchObject({
      success: false,
    });
    expect(await stop({ sender: owner }, 'stop-failure')).toMatchObject({
      success: false,
    });
    expect(process.kill).toHaveBeenCalledTimes(2);
  });

  it('does not report a stopped tree while a TERM-ignoring child survives', async () => {
    vi.useFakeTimers();
    const pty = fakePty();
    mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
    mocks.processes.set(54321, { parentPid: 1, birth: 1002n });
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'early-parent-exit' });
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (signal === 'SIGKILL') mocks.processes.delete(pid);
      return true;
    });
    let settled = false;
    const stopping = mocks.handles.get('terminal-stop')!(
      { sender: owner },
      'early-parent-exit'
    ).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(process.kill).toHaveBeenCalledWith(12346, 'SIGTERM');
    pty.emitExit(143);
    mocks.processes.get(12346)!.parentPid = 1;
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    expect(owner.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
    // A surviving owned child can start another generation during grace.
    mocks.processes.set(12347, { parentPid: 12346, birth: 1003n });
    await vi.advanceTimersByTimeAsync(1500);
    await stopping;
    expect(process.kill).toHaveBeenCalledWith(12346, 'SIGKILL');
    expect(process.kill).toHaveBeenCalledWith(12347, 'SIGKILL');
    expect(process.kill).not.toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(process.kill).not.toHaveBeenCalledWith(54321, expect.anything());
    expect(owner.send).toHaveBeenCalledWith('terminal-exit', {
      id: 'early-parent-exit',
      exitCode: 143,
    });
  });

  it('never signals a reused parent or descendant PID', async () => {
    vi.useFakeTimers();
    mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'pid-reuse' });
    const stopping = mocks.handles.get('terminal-stop')!(
      { sender: owner },
      'pid-reuse'
    );
    await vi.advanceTimersByTimeAsync(0);
    pty.emitExit(143);
    // Same PID and start second, different microsecond identity.
    mocks.processes.set(12345, { parentPid: 1, birth: 1003n });
    mocks.processes.set(12346, { parentPid: 1, birth: 1004n });
    mocks.processes.set(12347, { parentPid: 12345, birth: 1005n });
    vi.mocked(process.kill).mockClear();
    await vi.advanceTimersByTimeAsync(1600);
    expect(await stopping).toEqual({ success: true });
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('keeps orphaned descendants addressable after a failed force stop', async () => {
    vi.useFakeTimers();
    mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'retry-orphan' });
    vi.mocked(process.kill).mockImplementation((_pid, signal) => {
      if (signal === 'SIGKILL') throw new Error('denied');
      return true;
    });
    const stop = mocks.handles.get('terminal-stop')!;
    const first = stop({ sender: owner }, 'retry-orphan');
    await vi.advanceTimersByTimeAsync(0);
    pty.emitExit(143);
    mocks.processes.get(12346)!.parentPid = 1;
    await vi.advanceTimersByTimeAsync(1600);
    expect(await first).toMatchObject({ success: false });
    expect(owner.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (signal === 'SIGKILL') mocks.processes.delete(pid);
      return true;
    });
    const second = stop({ sender: owner }, 'retry-orphan');
    await vi.advanceTimersByTimeAsync(1600);
    expect(await second).toEqual({ success: true });
  });

  it.each(['tab', 'app'])(
    'disposes only owned descendants after failed Stop on %s cleanup',
    async (scope) => {
      vi.useFakeTimers();
      mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
      const pty = fakePty();
      // node-pty retains its PID after exit and kill() sends it SIGHUP.
      pty.kill.mockImplementation(() => process.kill(12345, 'SIGHUP'));
      mocks.spawn.mockReturnValue(pty);
      const owner = sender();
      await createHandler()({ sender: owner }, { id: 'dispose-after-failure' });
      vi.mocked(process.kill).mockImplementation((_pid, signal) => {
        if (signal === 'SIGKILL') throw new Error('child cleanup denied');
        return true;
      });
      const stopping = mocks.handles.get('terminal-stop')!(
        { sender: owner },
        'dispose-after-failure'
      );
      await vi.advanceTimersByTimeAsync(0);
      pty.emitExit(143);
      mocks.processes.get(12346)!.parentPid = 1;
      await vi.advanceTimersByTimeAsync(1600);
      expect(await stopping).toMatchObject({ success: false });
      mocks.processes.set(12345, { parentPid: 1, birth: 3000n });
      mocks.processes.set(12347, { parentPid: 12345, birth: 3001n });
      vi.mocked(process.kill)
        .mockClear()
        .mockImplementation((pid, signal) => {
          if (signal === 'SIGKILL') mocks.processes.delete(pid);
          return true;
        });
      const disposing =
        scope === 'tab'
          ? mocks.handles.get('terminal-dispose')!(
              { sender: owner },
              'dispose-after-failure'
            )
          : disposeAllTerminals();
      await vi.advanceTimersByTimeAsync(1600);
      await disposing;
      expect(process.kill).not.toHaveBeenCalledWith(12345, expect.anything());
      expect(process.kill).not.toHaveBeenCalledWith(12347, expect.anything());
      expect(pty.kill).not.toHaveBeenCalled();
      expect(process.kill).toHaveBeenCalledWith(12346, 'SIGKILL');
      expect(mocks.processes.has(12346)).toBe(false);
    }
  );

  it('joins Stop and concurrent disposals, waits for children, and blocks creates during quit', async () => {
    vi.useFakeTimers();
    mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
    const pty = fakePty();
    pty.kill.mockImplementation(() => process.kill(12345, 'SIGHUP'));
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'concurrent-cleanup' });
    const stopping = mocks.handles.get('terminal-stop')!(
      { sender: owner },
      'concurrent-cleanup'
    );
    await vi.advanceTimersByTimeAsync(0);
    pty.emitExit(143);
    mocks.processes.get(12346)!.parentPid = 1;
    mocks.processes.set(12345, { parentPid: 1, birth: 3000n });
    vi.mocked(process.kill).mockClear();
    const dispose = mocks.handles.get('terminal-dispose')!;
    const first = dispose({ sender: owner }, 'concurrent-cleanup');
    const second = dispose({ sender: owner }, 'concurrent-cleanup');
    let quitFinished = false;
    const quitting = disposeAllTerminals().then((result) => {
      quitFinished = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(process.kill).toHaveBeenCalledWith(12346, 'SIGKILL');
    expect(quitFinished).toBe(false);
    expect(
      await createHandler()({ sender: owner }, { id: 'late-create' })
    ).toMatchObject({ success: false });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    mocks.processes.delete(12346);
    await vi.advanceTimersByTimeAsync(100);
    for (const result of await Promise.all([stopping, first, second, quitting]))
      expect(result).toEqual({ success: true });
    expect(pty.kill).not.toHaveBeenCalled();
    expect(owner.send).not.toHaveBeenCalled();
  });

  it('retains a failed disposal for retry and refuses reattachment to it', async () => {
    vi.useFakeTimers();
    mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'retry-disposal' });
    const stopping = mocks.handles.get('terminal-stop')!(
      { sender: owner },
      'retry-disposal'
    );
    await vi.advanceTimersByTimeAsync(0);
    pty.emitExit(143);
    mocks.processes.get(12346)!.parentPid = 1;
    mocks.processes.set(12345, { parentPid: 1, birth: 3000n });
    vi.mocked(process.kill)
      .mockClear()
      .mockImplementation(() => {
        throw new Error('denied');
      });
    const dispose = mocks.handles.get('terminal-dispose')!;
    // Joins the in-flight Stop, then makes one bounded cleanup retry.
    const disposing = dispose({ sender: owner }, 'retry-disposal');
    await vi.advanceTimersByTimeAsync(100);
    expect(await stopping).toMatchObject({ success: false });
    expect(await disposing).toMatchObject({ success: false });
    expect(process.kill).toHaveBeenCalledTimes(2);
    expect(process.kill).not.toHaveBeenCalledWith(12345, expect.anything());
    expect(
      await createHandler()({ sender: owner }, { id: 'retry-disposal' })
    ).toMatchObject({ success: false });
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    pty.emitData('late output');
    mocks.listeners.get('terminal-input')!(
      {},
      { id: 'retry-disposal', data: 'x' }
    );
    mocks.listeners.get('terminal-resize')!(
      {},
      { id: 'retry-disposal', cols: 80, rows: 24 }
    );
    expect(owner.send).not.toHaveBeenCalled();
    expect(pty.write).not.toHaveBeenCalled();
    expect(pty.resize).not.toHaveBeenCalled();
    vi.mocked(process.kill)
      .mockClear()
      .mockImplementation((pid) => {
        mocks.processes.delete(pid);
        return true;
      });
    expect(await dispose({ sender: owner }, 'retry-disposal')).toEqual({
      success: true,
    });
    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(process.kill).toHaveBeenCalledWith(12346, 'SIGKILL');
    expect(await dispose({ sender: owner }, 'retry-disposal')).toEqual({
      success: true,
    });
    expect(process.kill).toHaveBeenCalledTimes(1);
  });

  it('waits for a late PTY exit without signalling its reused PID during disposal', async () => {
    vi.useFakeTimers();
    const pty = fakePty();
    pty.kill.mockImplementation(() => process.kill(12345, 'SIGHUP'));
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'late-exit' });
    // The OS has already reaped and reused the PID; node-pty's exit callback
    // has not been delivered to Electron yet.
    mocks.processes.set(12345, { parentPid: 1, birth: 3000n });
    mocks.processes.set(12346, { parentPid: 12345, birth: 3001n });
    let finished = false;
    const disposing = mocks.handles.get('terminal-dispose')!(
      { sender: owner },
      'late-exit'
    ).then((result: unknown) => {
      finished = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(finished).toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
    pty.emitExit(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(await disposing).toEqual({ success: true });
    expect(process.kill).not.toHaveBeenCalled();
    expect(pty.kill).not.toHaveBeenCalled();
    expect(mocks.processes.has(12345)).toBe(true);
    expect(mocks.processes.has(12346)).toBe(true);
    expect(owner.send).not.toHaveBeenCalled();
  });

  it.each(['tab', 'app'])(
    'cancels a pending lazy PTY creation on %s disposal',
    async (scope) => {
      mocks.spawn.mockReturnValue(fakePty());
      const owner = sender();
      const creation = createHandler()(
        { sender: owner },
        { id: 'pending-create' }
      );
      const disposal =
        scope === 'tab'
          ? mocks.handles.get('terminal-dispose')!(
              { sender: owner },
              'pending-create'
            )
          : disposeAllTerminals();
      expect(await creation).toMatchObject({ success: false });
      expect(await disposal).toEqual({ success: true });
      expect(mocks.spawn).not.toHaveBeenCalled();
      expect(process.kill).not.toHaveBeenCalled();
    }
  );

  it('fails disposal closed when spawn identity was not captured', async () => {
    mocks.processes.clear();
    const pty = fakePty();
    pty.kill.mockImplementation(() => process.kill(12345, 'SIGHUP'));
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'unowned-disposal' });
    mocks.processes.set(12345, { parentPid: 1, birth: 3000n });
    expect(
      await mocks.handles.get('terminal-dispose')!(
        { sender: owner },
        'unowned-disposal'
      )
    ).toMatchObject({ success: false });
    expect(process.kill).not.toHaveBeenCalled();
    expect(pty.kill).not.toHaveBeenCalled();
  });

  it('fails closed when the original process identity cannot be captured', async () => {
    mocks.processes.clear();
    mocks.spawn.mockReturnValue(fakePty());
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'no-identity' });
    // A later process with that PID must not become the terminal owner.
    mocks.processes.set(12345, { parentPid: 1, birth: 2000n });
    expect(
      await mocks.handles.get('terminal-stop')!(
        { sender: owner },
        'no-identity'
      )
    ).toMatchObject({ success: false });
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('reports failure if a captured child remains after the stop deadline', async () => {
    vi.useFakeTimers();
    mocks.processes.set(12346, { parentPid: 12345, birth: 1001n });
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'still-running' });
    const stopping = mocks.handles.get('terminal-stop')!(
      { sender: owner },
      'still-running'
    );
    await vi.advanceTimersByTimeAsync(0);
    pty.emitExit(143);
    mocks.processes.get(12346)!.parentPid = 1;
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stopping).toMatchObject({ success: false });
    expect(owner.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
  });

  it('waits for the Windows tree operation after an early PTY exit', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.useFakeTimers();
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'windows-stop' });
    let completeTree: (error?: Error) => void = () => {};
    mocks.killTree.mockImplementation((_pid, _signal, callback) => {
      completeTree = callback;
    });
    let settled = false;
    const stopping = mocks.handles.get('terminal-stop')!(
      { sender: owner },
      'windows-stop'
    ).then((result: unknown) => {
      settled = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(0);
    pty.emitExit(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    expect(owner.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
    completeTree();
    expect(await stopping).toEqual({ success: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(mocks.killTree).toHaveBeenCalledTimes(1);
  });

  it('does not retry a Windows PID after a failed tree stop and parent exit', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const pty = fakePty();
    mocks.spawn.mockReturnValue(pty);
    const owner = sender();
    await createHandler()({ sender: owner }, { id: 'windows-failure' });
    mocks.killTree.mockImplementation((_pid, _signal, callback) => {
      pty.emitExit(0);
      callback(new Error('tree operation failed'));
    });
    const stop = mocks.handles.get('terminal-stop')!;
    expect(await stop({ sender: owner }, 'windows-failure')).toMatchObject({
      success: false,
    });
    expect(await stop({ sender: owner }, 'windows-failure')).toMatchObject({
      success: false,
    });
    expect(mocks.killTree).toHaveBeenCalledTimes(1);
    expect(owner.send).not.toHaveBeenCalledWith(
      'terminal-exit',
      expect.anything()
    );
  });

  it.each(['tab', 'app'])(
    'does not reuse an exited Windows PID when %s disposal joins a failed Stop',
    async (scope) => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.useFakeTimers();
      const pty = fakePty();
      pty.kill.mockImplementation(() => process.kill(12345, 'SIGHUP'));
      mocks.spawn.mockReturnValue(pty);
      const owner = sender();
      await createHandler()({ sender: owner }, { id: 'windows-disposal' });
      let completeTree: (error?: Error) => void = () => {};
      mocks.killTree.mockImplementation((_pid, _signal, callback) => {
        completeTree = callback;
      });
      const stopping = mocks.handles.get('terminal-stop')!(
        { sender: owner },
        'windows-disposal'
      );
      await vi.advanceTimersByTimeAsync(0);
      const disposing =
        scope === 'tab'
          ? mocks.handles.get('terminal-dispose')!(
              { sender: owner },
              'windows-disposal'
            )
          : disposeAllTerminals();
      pty.emitExit(0);
      mocks.processes.set(12345, { parentPid: 1, birth: 3000n });
      completeTree(new Error('tree operation failed'));
      expect(await stopping).toMatchObject({ success: false });
      expect(await disposing).toMatchObject({ success: false });
      expect(mocks.killTree).toHaveBeenCalledTimes(1);
      expect(process.kill).not.toHaveBeenCalled();
      expect(pty.kill).not.toHaveBeenCalled();
    }
  );

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
        EIGENT_WORKSPACE_SECRET_BROKER_CAPABILITY: 'secret',
        EIGENT_WORKFORCE_SECRET_BROKER_CAPABILITY: 'legacy-secret',
      })
    ).toEqual({
      PATH: '/usr/bin',
      LANG: 'en_GB.UTF-8',
    });
  });

  it('ignores a disposed PTY exit after a replacement shell starts', async () => {
    const oldPty = fakePty();
    mocks.spawn.mockReturnValueOnce(oldPty);
    const outputSender = sender();

    await createHandler()({ sender: outputSender }, { id: 'restart-shell' });
    vi.mocked(process.kill).mockImplementation(() => {
      oldPty.emitExit(137);
      return true;
    });
    await mocks.handles.get('terminal-dispose')!(
      { sender: outputSender },
      'restart-shell'
    );
    mocks.processes.set(12345, { parentPid: process.pid, birth: 3000n });
    const replacementPty = fakePty();
    mocks.spawn.mockReturnValueOnce(replacementPty);
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
