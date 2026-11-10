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

import { exec } from 'child_process';
import log from 'electron-log';
import * as net from 'net';

/**
 * Local promise wrapper for `child_process.exec`.
 *
 * `util.promisify` is deliberately avoided: this module is imported by tests
 * running under jsdom, where Vite substitutes a browser shim for `util` that
 * has no `promisify`.
 */
function execAsync(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Resolve once the port is free or the delays are exhausted.
 *
 * Process teardown is asynchronous, so a single check after one fixed delay
 * reports a port as busy while the previous owner is still on its way out.
 */
const PORT_RELEASE_POLL_DELAYS_MS = [100, 200, 400, 800];

async function waitForPortReleased(port: number): Promise<boolean> {
  for (const delay of PORT_RELEASE_POLL_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (await checkPortAvailable(port)) return true;
  }
  return false;
}

/** Exit code a POSIX shell returns when the command itself is missing. */
const COMMAND_NOT_FOUND = 127;

export function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    // Set a timeout to prevent hanging
    const timeout = setTimeout(() => {
      server.close();
      resolve(false);
    }, 1000);

    server.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        // Try to connect to the port to verify it's truly in use
        const client = new net.Socket();
        client.setTimeout(500);

        client.once('connect', () => {
          client.destroy();
          resolve(false); // Port is definitely in use
        });

        client.once('error', () => {
          client.destroy();
          // Port might be in a weird state, consider it unavailable
          resolve(false);
        });

        client.once('timeout', () => {
          client.destroy();
          resolve(false);
        });

        client.connect(port, '127.0.0.1');
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      clearTimeout(timeout);
      server.close(() => {
        resolve(true);
      }); // port available, close then return
    });

    // force listen all addresses, prevent judgment
    server.listen({ port, host: '127.0.0.1', exclusive: true });
  });
}

/**
 * Ask the OS to terminate whatever holds `port`.
 *
 * `fuser` ships with psmisc, which minimal Linux images often omit, while
 * `lsof` is what the macOS path already relies on. Both are therefore tried
 * rather than assuming one is present: the previous `|| true` made a missing
 * tool indistinguishable from a successful kill.
 */
async function terminateProcessOnPort(
  port: number,
  force: boolean
): Promise<void> {
  const platform = process.platform;

  if (platform === 'win32') {
    const { stdout } = await execAsync(
      `netstat -ano | findstr LISTENING | findstr :${port}`
    );
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) {
      log.info(`no process listening on port ${port}`);
      return;
    }
    const pid = lines[0].trim().split(/\s+/).pop();
    if (!pid || isNaN(Number(pid))) {
      log.error(`Invalid PID extracted for port ${port}: ${pid}`);
      return;
    }
    log.info(`Killing PID ${pid} on port ${port}`);
    await execAsync(`taskkill /F /PID ${pid}`);
    return;
  }

  if (platform === 'darwin') {
    // lsof exits non-zero when nothing holds the port, which is the common
    // case here and not an error worth propagating.
    await execAsync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
    return;
  }

  if (force) {
    await execAsync(`fuser -k -9 ${port}/tcp 2>/dev/null || true`);
    return;
  }

  try {
    // No `|| true` here: a missing fuser has to be told apart from an empty
    // result, because only the former warrants a fallback.
    await execAsync(`fuser -k ${port}/tcp 2>/dev/null`);
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === COMMAND_NOT_FOUND) {
      log.warn(`fuser unavailable, falling back to lsof for port ${port}`);
      await execAsync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`);
      return;
    }
    // Any other failure means fuser ran and held nothing, which is already the
    // desired end state for this port.
    log.info(`No process held port ${port} (fuser exit ${code})`);
  }
}

/**
 * Free `port`, escalating from SIGTERM to SIGKILL if the graceful request is
 * not honoured.
 *
 * Returns whether the port is actually free. Process teardown is asynchronous,
 * so the port is polled rather than assumed: the previous implementation sent a
 * single kill, slept a fixed 500ms, and reported whatever that one check said —
 * which is how a still-bound port got reported as released and the backend then
 * failed to bind at startup.
 */
export async function killProcessOnPort(port: number): Promise<boolean> {
  try {
    await terminateProcessOnPort(port, false);

    if (await waitForPortReleased(port)) {
      log.info(`Port ${port} released`);
      return true;
    }

    log.warn(`Port ${port} still held after SIGTERM, escalating to SIGKILL`);
    await terminateProcessOnPort(port, true);

    if (await waitForPortReleased(port)) {
      log.info(`Port ${port} released after SIGKILL`);
      return true;
    }

    log.error(
      `Port ${port} is still in use after SIGKILL; another process is holding ` +
        `it, or it belongs to a privileged user`
    );
    return false;
  } catch (error) {
    log.error(`Failed to kill process on port ${port}:`, error);
    return false;
  }
}

export async function findAvailablePort(
  startPort: number,
  maxAttempts = 50
): Promise<number> {
  const triedPorts = new Set<number>();

  const tryPort = async (port: number): Promise<number | null> => {
    if (triedPorts.has(port)) return null;
    triedPorts.add(port);

    const available = await checkPortAvailable(port);
    if (available) {
      return port;
    }

    const killed = await killProcessOnPort(port);
    if (killed) {
      return port;
    }

    return null;
  };

  // return when found port
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = startPort + offset;
    const found = await tryPort(port);
    if (found) return found;
  }

  throw new Error(
    `No available port found in range ${startPort} ~ ${startPort + maxAttempts - 1}`
  );
}
