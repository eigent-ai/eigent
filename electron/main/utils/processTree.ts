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

import { ChildProcess, exec, spawn } from 'child_process';
import log from 'electron-log';

/**
 * Termination of the backend process tree, verified against actual exit.
 *
 * Both the startup-failure path and the app-quit path used to resolve as soon
 * as a signal had been *delivered*, and kill only the parent PID. Three
 * consequences, each of which leaves an orphaned backend holding its port:
 *
 * - `kill()` completing means the signal was sent, not that the process
 *   handled it. The backend's own `cleanup_resources()` drains execution
 *   services, the cloud sync worker and a WebSocket pool, which takes seconds.
 * - The `setTimeout(..., 1000)` that sends SIGKILL is dropped if the app exits
 *   first, which is exactly what happens during a quit.
 * - The backend spawns children. Signalling the parent PID alone leaves the
 *   workers running, and the workers are what hold the port.
 */

/** How long the process gets to exit on its own after SIGTERM. */
const GRACE_PERIOD_MS = 2000;

/** How long we then wait for SIGKILL to take effect before giving up. */
const FORCE_WAIT_MS = 3000;

/** Whether a process with this id currently exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to another user, which still counts
    // as alive: we have not managed to stop it.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Wait until the child reports it has exited, or the timeout elapses.
 *
 * The listener is attached before anything else touches the emitter, because
 * the previous implementation called `removeAllListeners()` first and thereby
 * discarded the only event that reports real termination.
 */
function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('close', onClose);
      child.off('exit', onClose);
      child.off('error', onClose);
      resolve(exited);
    };

    const onClose = () => finish(true);

    child.once('close', onClose);
    child.once('exit', onClose);
    // A spawn failure is not a running process either.
    child.once('error', onClose);

    const timer = setTimeout(() => finish(false), timeoutMs);
  });
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stop a process and its children, and confirm it actually stopped.
 *
 * @returns `true` once the process is gone, `false` if it is still running
 *   after the force window. A `false` is worth logging: the caller may be
 *   about to exit with the port still held.
 */
export async function terminateProcessTree(
  child: ChildProcess | null | undefined,
  { gracePeriodMs = GRACE_PERIOD_MS }: { gracePeriodMs?: number } = {}
): Promise<boolean> {
  const pid = child?.pid;
  if (!pid) return true;

  // Already gone: nothing to signal, and a signal would throw ESRCH.
  if (child.exitCode !== null || child.signalCode !== null) return true;
  if (!isAlive(pid)) return true;

  const exited = waitForExit(child, gracePeriodMs);

  if (process.platform === 'win32') {
    // taskkill /T walks the tree for us.
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      killer.on('error', () => resolve());
      killer.on('close', () => resolve());
    });
  } else {
    // Negative pid targets the process group, so the workers die with the
    // parent. Fall back to the bare pid when the child was not made a group
    // leader, which is what happens if spawning used the shell.
    signalGroup(pid, 'SIGTERM');
  }

  if (await exited) {
    log.info(`Backend process ${pid} exited after SIGTERM`);
    return true;
  }

  log.warn(`Backend process ${pid} ignored SIGTERM, sending SIGKILL`);
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
      killer.on('error', () => resolve());
      killer.on('close', () => resolve());
    });
  } else {
    signalGroup(pid, 'SIGKILL');
  }

  if (await waitForExit(child, FORCE_WAIT_MS)) {
    log.info(`Backend process ${pid} exited after SIGKILL`);
    return true;
  }

  log.error(
    `Backend process ${pid} is still alive ${FORCE_WAIT_MS}ms after SIGKILL; ` +
      `its port may stay held after exit`
  );
  return false;
}

/** Signal a process group, falling back to the process itself. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (groupError) {
    const code = (groupError as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return;
    try {
      process.kill(pid, signal);
    } catch (processError) {
      log.error(
        `Failed to send ${signal} to ${pid}:`,
        (processError as Error).message
      );
    }
  }
}

/** Remove the non-essential listeners a long-lived child accumulates. */
export function releaseChildListeners(child: ChildProcess): void {
  // `close`/`exit`/`error` are deliberately kept: they are how termination is
  // observed, and dropping them is what made the old cleanup unverifiable.
  for (const event of ['stdout', 'stderr'] as const) {
    child.removeAllListeners(event);
  }
}

/** Wait for a child to exit without signalling it. */
export { delay, waitForExit };

/** Re-exported for callers that only need a one-shot spawn wrapper. */
export { exec };
