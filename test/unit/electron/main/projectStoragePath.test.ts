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

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getProjectIdentityCandidates,
  resolveProjectStoragePath,
} from '../../../../electron/main/utils/projectStoragePath';

describe('projectStoragePath', () => {
  it('prefers user-id project directories over legacy email directories', () => {
    const homeDir = '/Users/test';
    const userProjectPath = path.join(
      homeDir,
      'eigent',
      'user_42',
      'project_p1'
    );
    const legacyProjectPath = path.join(
      homeDir,
      'eigent',
      'alice',
      'project_p1'
    );
    const existsSync = vi.fn(
      (candidate: string) =>
        candidate === userProjectPath || candidate === legacyProjectPath
    );

    const resolved = resolveProjectStoragePath({
      homeDir,
      email: 'alice@example.com',
      projectId: 'p1',
      userId: 42,
      existsSync,
    });

    expect(resolved).toBe(userProjectPath);
    expect(existsSync.mock.calls.map(([candidate]) => candidate)).not.toContain(
      legacyProjectPath
    );
  });

  it('falls back to legacy email directories when user-id directories are missing', () => {
    const homeDir = '/Users/test';
    const legacyProjectPath = path.join(
      homeDir,
      'eigent',
      'alice',
      'project_p1'
    );

    const resolved = resolveProjectStoragePath({
      homeDir,
      email: 'alice@example.com',
      projectId: 'p1',
      userId: 42,
      existsSync: (candidate) => candidate === legacyProjectPath,
    });

    expect(resolved).toBe(legacyProjectPath);
  });

  it('does not search user-id directories when no user id is supplied', () => {
    expect(getProjectIdentityCandidates('alice@example.com')).toEqual([
      'alice',
    ]);
  });
});
