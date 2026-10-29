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

import { approvalTargets } from '@/lib/approvalPresentation';
import { describe, expect, it } from 'vitest';

const commandDigest = `terminal-command:sha256:${'c'.repeat(64)}`;

describe('approvalTargets', () => {
  it('keeps file paths and URLs as requested', () => {
    expect(
      approvalTargets({
        operation: 'filesystem.write',
        targetResources: ['u15/act7.txt', 'https://example.com/a', ''],
      })
    ).toEqual([
      { kind: 'path', value: 'u15/act7.txt' },
      { kind: 'url', value: 'https://example.com/a' },
    ]);
  });

  it('replaces a shell command digest with its command line', () => {
    expect(
      approvalTargets({
        operation: 'terminal.execute',
        targetResources: [commandDigest, 'u15'],
        displayArguments: { command: '  npm test  ', id: 'term-1' },
      })
    ).toEqual([
      { kind: 'command', value: 'npm test' },
      { kind: 'path', value: 'u15' },
    ]);
  });

  it('joins argv the way a shell would read it', () => {
    expect(
      approvalTargets({
        targetResources: [commandDigest],
        displayArguments: { argv: ['git', 'commit', '-m', "it's done"] },
      })
    ).toEqual([{ kind: 'command', value: `git commit -m 'it'"'"'s done'` }]);
  });

  it('shows nothing for a digest whose arguments were truncated', () => {
    expect(
      approvalTargets({
        operation: 'terminal.execute',
        targetResources: [commandDigest],
        displayArguments: { truncated: true, preview: '{"command": "…' },
      })
    ).toEqual([]);
  });

  it('omits opaque tool identities and command fields of other operations', () => {
    expect(
      approvalTargets({
        operation: 'mcp.tool.write',
        targetResources: [`tool-identity:sha256:${'d'.repeat(64)}`],
        displayArguments: { command: 'not a shell call' },
      })
    ).toEqual([]);
  });
});
