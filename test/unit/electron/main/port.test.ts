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

/**
 * Shared mutable state for the mocked modules.
 *
 * `vi.hoisted` is required: every `vi.mock` factory is hoisted above the
 * imports, so a factory closing over a plain `let` would read it unassigned.
 */
const state = vi.hoisted(() => ({
  /** Whether the port under test is currently occupied. */
  portOccupied: true,
  /** Every command issued, in order. */
  issuedCommands: [] as string[],
  /**
   * Decides how each command behaves. Return a POSIX exit code to make `exec`
   * fail with it, or null to let it succeed.
   */
  respond: null as null | ((cmd: string) => number | null),
}));

/**
 * The logger is built with plain recording functions rather than `vi.fn()`:
 * hoisted code runs above the `vi` import, so `vi.fn()` is still in its
 * temporal dead zone there.
 */
const logMock = vi.hoisted(() => {
  const entries: { level: string; message: string }[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      entries.push({ level, message: args.map(String).join(' ') });
    };
  return {
    entries,
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    verbose: record('verbose'),
    silly: record('silly'),
    initialize: () => undefined,
  };
});

vi.mock('electron-log', () => ({ default: logMock, ...logMock }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  // Callbacks fire synchronously: the port checks and the kill sequence are
  // then fully deterministic and no timer draining is needed.
  const execMock = (
    cmd: string,
    callback: (error: unknown, stdout: string, stderr: string) => void
  ) => {
    state.issuedCommands.push(cmd);
    const code = state.respond?.(cmd) ?? null;
    callback(
      code === null ? null : Object.assign(new Error(`exit ${code}`), { code }),
      '',
      ''
    );
    return { on: () => undefined, kill: () => undefined };
  };
  // The explicit `default` is required: this module is loaded through CJS
  // interop, and without it the import silently resolves to the real `exec`.
  return { ...actual, exec: execMock, default: { ...actual, exec: execMock } };
});

vi.mock('net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('net')>();
  // Required inside the factory: mock factories are hoisted above the imports,
  // so a top-level EventEmitter would still be uninitialized here.
  const { EventEmitter } = await import('node:events');

  class FakeSocket extends EventEmitter {
    setTimeout() {
      return this;
    }
    destroy() {
      return this;
    }
    connect() {
      this.emit('error', new Error('refused'));
      return this;
    }
  }

  return {
    ...actual,
    createServer: () => {
      const server = new EventEmitter() as EventEmitter &
        Record<string, unknown>;
      server.listen = () => {
        if (state.portOccupied) {
          server.emit('error', { code: 'EADDRINUSE' });
        } else {
          server.emit('listening');
        }
        return server;
      };
      server.close = (callback?: () => void) => {
        callback?.();
        return server;
      };
      return server;
    },
    Socket: FakeSocket,
  };
});

/** Load the module fresh so the mocks above are picked up. */
async function loadPort() {
  vi.resetModules();
  return import('../../../../electron/main/utils/port');
}

/**
 * Drain the poll loop. A bounded advance is used instead of
 * `runAllTimersAsync`, which keeps re-running timers until none remain.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    await vi.advanceTimersByTimeAsync(100);
  }
}

/** Release the port only when a forced kill runs. */
function releaseOnForceKill(cmd: string): null {
  if (cmd.includes('-9')) state.portOccupied = false;
  return null;
}

beforeEach(() => {
  state.portOccupied = true;
  state.issuedCommands = [];
  state.respond = null;
  logMock.entries.length = 0;
  vi.useFakeTimers();
});

describe('killProcessOnPort', () => {
  it('returns true once the port is free', async () => {
    const { killProcessOnPort } = await loadPort();
    state.respond = releaseOnForceKill;

    const promise = killProcessOnPort(5001);
    await settle();

    expect(await promise).toBe(true);
  });

  it('escalates to SIGKILL when SIGTERM does not free the port', async () => {
    // The core of #1668: a process that does not act on SIGTERM keeps the port
    // bound. The previous code sent one fuser call, slept a fixed 500ms, and
    // returned whatever that single check happened to say.
    const { killProcessOnPort } = await loadPort();
    state.respond = releaseOnForceKill;

    const promise = killProcessOnPort(5001);
    await settle();
    const result = await promise;

    expect(state.issuedCommands.some((c) => c.includes('fuser -k -9'))).toBe(
      true
    );
    expect(result).toBe(true);
  });

  it('returns false when the port is never released', async () => {
    const { killProcessOnPort } = await loadPort();

    const promise = killProcessOnPort(5001);
    await settle();

    expect(await promise).toBe(false);
  });

  it('falls back to lsof when fuser is not installed', async () => {
    // psmisc is absent on minimal images. The previous `|| true` made a missing
    // tool indistinguishable from a successful kill.
    const { killProcessOnPort } = await loadPort();
    state.respond = (cmd) => {
      if (cmd.startsWith('fuser') && !cmd.includes('-9')) return 127;
      state.portOccupied = false;
      return null;
    };

    const promise = killProcessOnPort(5001);
    await settle();
    const result = await promise;

    expect(state.issuedCommands.some((c) => c.startsWith('lsof'))).toBe(true);
    expect(result).toBe(true);
  });

  it('does not fall back to lsof when fuser simply found nothing', async () => {
    // fuser exits 1 when no process holds the port. That is the desired end
    // state, not a missing tool, and must not trigger a second kill path.
    const { killProcessOnPort } = await loadPort();
    state.respond = (cmd) => {
      if (cmd.startsWith('fuser') && !cmd.includes('-9')) return 1;
      state.portOccupied = false;
      return null;
    };

    const promise = killProcessOnPort(5001);
    await settle();
    await promise;

    expect(state.issuedCommands.some((c) => c.startsWith('lsof'))).toBe(false);
  });

  it('logs why the port could not be freed', async () => {
    const { killProcessOnPort } = await loadPort();

    const promise = killProcessOnPort(5001);
    await settle();
    await promise;

    const logged = logMock.entries
      .filter((e) => e.level === 'warn' || e.level === 'error')
      .map((e) => e.message)
      .join('\n');
    expect(logged).toContain('5001');
  });
});

describe('checkPortAvailable', () => {
  it('reports a free port as available', async () => {
    const { checkPortAvailable } = await loadPort();
    state.portOccupied = false;

    expect(await checkPortAvailable(5001)).toBe(true);
  });

  it('reports an occupied port as unavailable', async () => {
    const { checkPortAvailable } = await loadPort();
    state.portOccupied = true;

    expect(await checkPortAvailable(5001)).toBe(false);
  });
});
