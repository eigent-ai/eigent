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

describe('bundled Git supply chain', () => {
  it('pins and verifies the Windows MinGit archive', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'scripts/preinstall-deps.js'),
      'utf-8'
    );

    expect(source).toContain("const MINGIT_VERSION = '2.55.0.3'");
    expect(source).toContain('v2.55.0.windows.3/MinGit-2.55.0.3-64-bit.zip');
    expect(source).toContain(
      'f48e2d2dc74a24454adc6d8fd0ac25bf9c2386f19cfb06202b9465aaad4f9f05'
    );
    expect(source).toContain('MinGit checksum mismatch');
    expect(source).toContain('await installMinGit()');
  });

  it('passes the packaged Git executable to the Brain process', () => {
    const processSource = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/utils/process.ts'),
      'utf-8'
    );
    const startupSource = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/init.ts'),
      'utf-8'
    );

    expect(processSource).toContain("'mingit'");
    expect(processSource).toContain("'git.exe'");
    expect(startupSource).toContain('getBundledGitPath()');
    expect(startupSource).toContain('EIGENT_BUNDLED_GIT: bundledGitPath');
  });
});
