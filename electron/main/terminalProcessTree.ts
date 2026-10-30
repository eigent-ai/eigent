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

import koffi from 'koffi';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface ProcessIdentity {
  pid: number;
  parentPid: number;
  birth: string;
  zombie: boolean;
}

let procPidInfo: ReturnType<ReturnType<typeof koffi.load>['func']> | undefined;

/** Read a birth identity, not ps lstart (which loses subsecond PID reuse). */
function readProcess(pid: number): ProcessIdentity | undefined {
  if (pid <= 1 || pid === process.pid) return undefined;
  if (process.platform === 'darwin') {
    procPidInfo ??= koffi
      .load('/usr/lib/libproc.dylib')
      .func(
        'int proc_pidinfo(int pid, int flavor, uint64_t arg, void *buffer, int size)'
      );
    // Public proc_bsdinfo / PROC_PIDTBSDINFO from sys/proc_info.h. The final
    // two uint64 fields are process start seconds and microseconds.
    const info = Buffer.alloc(136);
    if (procPidInfo(pid, 3, 0, info, info.length) !== info.length) {
      if (koffi.errno() === 3) return undefined; // ESRCH: already reaped
      throw new Error('Could not inspect terminal process identity');
    }
    return {
      pid,
      parentPid: info.readUInt32LE(16),
      birth: `${info.readBigUInt64LE(120)}:${info.readBigUInt64LE(128)}`,
      zombie: info.readUInt32LE(4) === 5, // SZOMB
    };
  }
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // comm may contain spaces or parentheses; fields after its final ')'
      // begin with state (3), ppid (4), ... starttime (22, clock ticks).
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (fields.length < 20) throw new Error('Invalid terminal process stat');
      return {
        pid,
        parentPid: Number(fields[1]),
        birth: fields[19],
        zombie: fields[0] === 'Z',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  throw new Error('Terminal process identity is unavailable');
}

function listParents(): Promise<Array<{ pid: number; parentPid: number }>> {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/ps',
      ['-A', '-o', 'pid=,ppid='],
      { encoding: 'utf8', timeout: 1000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        resolve(
          stdout
            .trim()
            .split('\n')
            .flatMap((line) => {
              const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
              return match
                ? [{ pid: Number(match[1]), parentPid: Number(match[2]) }]
                : [];
            })
        );
      }
    );
  });
}

/** In-memory ownership for one PTY Stop; retained across reparenting/retries. */
export class TerminalProcessTree {
  private readonly owned = new Map<number, ProcessIdentity>();

  constructor(pid: number) {
    const root = readProcess(pid);
    if (!root) throw new Error('Terminal process identity is unavailable');
    this.owned.set(pid, root);
  }

  private current(owner: ProcessIdentity) {
    const current = readProcess(owner.pid);
    if (!current || current.birth !== owner.birth || current.zombie) {
      this.owned.delete(owner.pid);
      return undefined;
    }
    return current;
  }

  private async refresh() {
    const parents = await listParents();
    const live = new Map<number, ProcessIdentity>();
    for (const owner of this.owned.values()) {
      const current = this.current(owner);
      if (current) live.set(current.pid, current);
    }
    // Map iteration also visits added descendants, so capture every level
    // before TERM can make a parent disappear. Never adopt a reused parent.
    for (const owner of live.values()) {
      for (const row of parents) {
        if (row.parentPid !== owner.pid || live.has(row.pid)) continue;
        const child = readProcess(row.pid);
        if (
          child &&
          child.parentPid === owner.pid &&
          !child.zombie &&
          this.current(owner)
        ) {
          live.set(child.pid, child);
          this.owned.set(child.pid, child);
        }
      }
    }
    return [...live.values()];
  }

  async signal(signal: 'SIGTERM' | 'SIGKILL') {
    const live = await this.refresh();
    for (const owner of live.reverse()) {
      // Recheck immediately before signalling. Never signal a negative PGID
      // or re-traverse the old root PID after its process has exited.
      if (!this.current(owner)) continue;
      try {
        process.kill(owner.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }

  async isRunning() {
    return (await this.refresh()).length > 0;
  }
}
