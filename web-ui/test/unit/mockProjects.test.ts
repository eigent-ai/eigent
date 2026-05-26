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

import { fetchGroupedProjects } from '@web/api/server';
import { MOCK_PROJECT_GROUPS } from '@web/mock/data';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@web/lib/mockMode', () => ({
  isWebUiMock: () => true,
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: vi.fn(),
}));

describe('mock grouped projects', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns seeded mock projects without calling the network', async () => {
    const { proxyFetchGet } = await import('@/api/http');
    const projects = await fetchGroupedProjects();

    expect(proxyFetchGet).not.toHaveBeenCalled();
    expect(projects).toHaveLength(MOCK_PROJECT_GROUPS.length);
    expect(projects.map((project) => project.project_id)).toEqual(
      MOCK_PROJECT_GROUPS.map((project) => project.project_id)
    );
  });
});
