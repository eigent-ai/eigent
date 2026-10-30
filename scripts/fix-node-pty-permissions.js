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

/* global console, process */

// npm strips the execute bit from node-pty's prebuilt `spawn-helper` on
// macOS, which makes every pty.spawn() fail with "posix_spawnp failed".
// Restore it after install. No-op on other platforms / missing files.
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const prebuilds = join(root, 'node_modules', 'node-pty', 'prebuilds');
  if (existsSync(prebuilds)) {
    for (const target of readdirSync(prebuilds)) {
      const helper = join(prebuilds, target, 'spawn-helper');
      if (existsSync(helper)) {
        try {
          chmodSync(helper, 0o755);
          console.log(`[fix-node-pty] chmod +x ${helper}`);
        } catch (error) {
          console.warn(`[fix-node-pty] failed for ${helper}:`, error.message);
        }
      }
    }
  }
}
