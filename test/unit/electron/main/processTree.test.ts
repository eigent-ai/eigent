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

import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Recorded signals, and the process ids the code under test is allowed to
 * treat as alive.
 *
 * `vi.hoisted` is required because `vi.mock` factories are hoisted above the
 * imports. Plain functions are used rather than `vi.fn()`, which is still in
 * its temporal dead zone at that point.
 */
const state = vi.hoisted(() => ({
  signals: [] as { pid: number; signal: string }[],
  /** Ids reported as alive by `process.kill(pid, 0)`. */
  alive: new Set<number>(),
}));

vi.mock('electron-log', () => {
  const record =
    (level: string) =>
    (...args: unknown[]) => {
      void level;
      void args;
    };
  const logger = {
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    debug: record('debug'),
    verbose: record('verbose'),
    silly: record('silly'),
    initialize: record('initialize'),
  };
  return { default: logger, ...logger };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const { EventEmitter: Emitter } = await import('node:events');
  return {
    ...actual,
    spawn: () => {
      const killer = new Emitter();
      setImmediate(() => killer.emit('close', 0));
      return killer;
    },
  };
});

/** A minimal ChildProcess stand-in. */
class FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  /** Pretend the process exited, as the real emitter would. */
  exit(): void {
    this.exitCode = 0;
    this.emit('exit', 0, null);
    this.emit('close', 0, null);
  }
}

async function loadModule() {
  vi.resetModules();
  return import('../../../../electron/main/utils/processTree');
}

/** Let the implementation's timers run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    await vi.advanceTimersByTimeAsync(100);
  }
}

beforeEach(() => {
  state.signals = [];
  state.alive = new Set();
  vi.useFakeTimers();
  vi.spyOn(process, 'kill').mockImplementation(((
    pid: number,
    signal?: string
  ) => {
    if (signal === '0') {
      if (state.alive.has(pid)) return true;
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    }
    state.signals.push({ pid, signal: String(signal) });
    return true;
  }) as typeof process.kill);
});

describe('terminateProcessTree', () => {
  it('waits for the process to actually exit before resolving', async () => {
    // The defect: the old code resolved as soon as the signal was delivered,
    // so the caller believed cleanup was done while the backend was still
    // draining. Here the exit only happens after the caller has had to wait.
    const { terminateProcessTree } = await loadModule();
    const child = new FakeChild(4242);
    state.alive.add(4242);

    const pending = terminateProcessTree(child, { gracePeriodMs: 2000 });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(false);

    child.exit();
    await settle();

    expect(await pending).toBe(true);
  });

  it('signals the process group, not just the parent', async () => {
    // The backend spawns workers, and the workers hold the port. Signalling
    // only the parent pid left them running.
    const { terminateProcessTree } = await loadModule();
    const child = new FakeChild(5150);
    state.alive.add(5150);

    const pending = terminateProcessTree(child, { gracePeriodMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    child.exit();
    await settle();
    await pending;

    expect(state.signals).toContainEqual({ pid: -5150, signal: 'SIGTERM' });
  });

  it('escalates to SIGKILL when SIGTERM is ignored', async () => {
    const { terminateProcessTree } = await loadModule();
    const child = new FakeChild(6161);
    state.alive.add(6161);

    const pending = terminateProcessTree(child, { gracePeriodMs: 1000 });
    // No exit event: the process ignores SIGTERM.
    await vi.advanceTimersByTimeAsync(1500);
    child.exit();
    await settle();

    expect(await pending).toBe(true);
    expect(state.signals.some((s) => s.signal === 'SIGKILL')).toBe(true);
  });

  it('reports failure when the process survives SIGKILL', async () => {
    // A `false` is what lets the caller log that the port may stay held,
    // rather than quitting silently on top of a live backend.
    const { terminateProcessTree } = await loadModule();
    const child = new FakeChild(7171);
    state.alive.add(7171);

    const pending = terminateProcessTree(child, { gracePeriodMs: 1000 });
    await settle();

    expect(await pending).toBe(false);
  });

  it('does nothing for a process that is already gone', async () => {
    const { terminateProcessTree } = await loadModule();
    const child = new FakeChild(8181);
    child.exitCode = 0;

    expect(await terminateProcessTree(child)).toBe(true);
    expect(state.signals).toHaveLength(0);
  });

  it('treats a missing pid as already stopped', async () => {
    const { terminateProcessTree } = await loadModule();
    expect(await terminateProcessTree(null)).toBe(true);
  });
});

describe('releaseChildListeners', () => {
  it('keeps the listeners that report termination', async () => {
    // Removing these first is what made the old cleanup unable to observe the
    // exit it was waiting for.
    const { releaseChildListeners } = await loadModule();
    const child = new FakeChild(9191);
    const onStdout = vi.fn();
    child.on('stdout', onStdout);
    child.on('close', () => undefined);

    releaseChildListeners(child as never);

    expect(child.listenerCount('stdout')).toBe(0);
    expect(child.listenerCount('close')).toBe(1);
  });
});
