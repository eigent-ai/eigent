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

describe('Brain app version', () => {
  it('passes the Electron app version to the Brain process', () => {
    const startupSource = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/init.ts'),
      'utf-8'
    );

    expect(startupSource).toContain('const currentVersion = app.getVersion()');
    expect(startupSource).toContain('EIGENT_APP_VERSION: currentVersion');
  });

  it('keeps package.json as the only place the version is written', () => {
    const toolkitSource = fs.readFileSync(
      path.resolve(
        process.cwd(),
        'backend/app/agent/toolkit/terminal_toolkit.py'
      ),
      'utf-8'
    );

    expect(toolkitSource).toContain('APP_VERSION = resolve_app_version()');
    expect(toolkitSource).not.toMatch(/APP_VERSION = ["']\d/);
  });
});
