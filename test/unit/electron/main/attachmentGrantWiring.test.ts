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

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function handlerBlock(source: string, channel: string, nextChannel: string) {
  const start = source.indexOf(`'${channel}'`);
  const end = source.indexOf(`'${nextChannel}'`, start + channel.length + 2);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('chat attachment path grant wiring', () => {
  it('guards and registers every user-driven attachment entry point', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );

    const selectFile = handlerBlock(
      source,
      'select-file',
      'select-agent-plugin-source'
    );
    const droppedFiles = handlerBlock(
      source,
      'process-dropped-files',
      'save-pasted-file'
    );
    const pastedFile = handlerBlock(
      source,
      'save-pasted-file',
      'reveal-in-folder'
    );

    for (const block of [selectFile, droppedFiles, pastedFile]) {
      expect(block).toContain('assertMainRendererSender(event)');
      expect(block).toContain('rememberUserSelectedLocalPath');
    }
    expect(selectFile).toContain('fsp.realpath(filePath)');
    expect(droppedFiles).toContain('fs.realpathSync(f.path!)');
    expect(pastedFile).toContain('fsp.realpath(filePath)');
  });

  it('keeps attachment grants explicitly session-scoped and bounded', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf8'
    );

    expect(source).toContain(
      'const userSelectedLocalPaths = new Set<string>()'
    );
    expect(source).toContain('const USER_SELECTED_PATH_LIMIT = 512');
  });
});
