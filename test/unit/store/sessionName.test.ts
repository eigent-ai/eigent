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

import { syncProjectDisplayName } from '@/store/chatStore';
import { useProjectStore } from '@/store/projectStore';
import { useSpaceStore } from '@/store/spaceStore';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.restoreAllMocks());

it('keeps an assigned session name through follow-up and Stop metadata', () => {
  const project = { name: 'New project', metadata: {} };
  const meta = { name: 'New project', metadata: {} };
  vi.spyOn(useProjectStore, 'getState').mockReturnValue({
    getProjectById: () => project,
    updateProject: (_id: string, update: object) =>
      Object.assign(project, update),
  } as any);
  vi.spyOn(useSpaceStore, 'getState').mockReturnValue({
    getProjectMeta: () => meta,
    updateProjectMeta: (_id: string, update: object) =>
      Object.assign(meta, update),
  } as any);
  syncProjectDisplayName('session', 'Original request');
  syncProjectDisplayName('session', 'Follow-up title');
  syncProjectDisplayName('session', 'Stopped task title');
  expect(project.name).toBe('Original request');
  expect(meta.name).toBe('Original request');
  Object.assign(project, {
    name: 'New project',
    metadata: { nameSource: 'manual' },
  });
  Object.assign(meta, {
    name: 'New project',
    metadata: { nameSource: 'manual' },
  });
  syncProjectDisplayName('session', 'Delayed summary');
  expect(project.name).toBe('New project');
  expect(meta.name).toBe('New project');
});
