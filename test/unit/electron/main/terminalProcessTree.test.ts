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

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { expect, it } from 'vitest';
import { TerminalProcessTree } from '../../../../electron/main/terminalProcessTree';

it.skipIf(process.platform === 'win32')(
  'cleans its own TERM-ignoring child after the fixture parent exits',
  async () => {
    // No shell, profile, provider, workspace command or inherited credentials.
    // Both fixture processes self-expire even if an assertion/cleanup fails.
    const parent = spawn(
      process.execPath,
      [path.resolve('test/fixtures/terminal-stop-parent.cjs')],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {} }
    );
    let tree: TerminalProcessTree | undefined;
    let childTree: TerminalProcessTree | undefined;
    try {
      const [message] = await once(parent, 'message');
      const childPid = (message as { childPid: number }).childPid;
      tree = new TerminalProcessTree(parent.pid!);
      childTree = new TerminalProcessTree(childPid);
      const parentExit = once(parent, 'exit');
      await tree.signal('SIGTERM');
      await parentExit;
      expect(await tree.isRunning()).toBe(true);
      await tree.signal('SIGKILL');
      await expect.poll(() => tree!.isRunning()).toBe(false);
      expect(await childTree.isRunning()).toBe(false);
    } finally {
      await Promise.allSettled([
        tree?.signal('SIGKILL'),
        childTree?.signal('SIGKILL'),
      ]);
      if (parent.exitCode === null && parent.signalCode === null)
        parent.kill('SIGKILL');
    }
  },
  15000
);
