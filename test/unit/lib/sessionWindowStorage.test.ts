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
// Same module order as the app entry: i18n before the stores.
import '../../../src/i18n';
import { applySessionWindowStoragePolicy } from '../../../src/lib/sessionWindowStorage';

type PersistApi = {
  persist: {
    getOptions: () => {
      name?: string;
      storage?: { setItem: (name: string, value: unknown) => unknown };
    };
  };
};

const storeDir = path.resolve(process.cwd(), 'src/store');

describe('Session window storage policy', () => {
  it('makes every persisted store read-only, including ones added later', async () => {
    applySessionWindowStoragePolicy({ spaceId: 'space', projectId: 'p' });

    // Every store module, loaded the way Vite resolves them in the app.
    const storeModules = import.meta.glob<Record<string, unknown>>(
      '../../../src/store/*.ts'
    );
    const persisted: string[] = [];
    for (const [modulePath, load] of Object.entries(storeModules)) {
      const file = path.basename(modulePath);
      if (
        !fs.readFileSync(path.join(storeDir, file), 'utf8').includes('persist(')
      )
        continue;
      const module = await load();
      for (const [exportName, value] of Object.entries(module)) {
        const api = value as Partial<PersistApi> | null;
        if (typeof value !== 'function' || !api?.persist?.getOptions) continue;
        const { name, storage } = api.persist.getOptions();
        persisted.push(`${file}:${exportName}`);
        const probe = `session-window-probe:${name}`;
        storage?.setItem(probe, { state: {}, version: 0 });
        expect(localStorage.getItem(probe), `${file} ${exportName}`).toBeNull();
      }
    }
    // Guard the scan itself: it must have found the stores it protects.
    expect(persisted.length).toBeGreaterThanOrEqual(9);
  });
});
