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

import { fetchGroupedHistoryProjects } from '@/service/historyApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyFetchGetMock } = vi.hoisted(() => ({
  proxyFetchGetMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: proxyFetchGetMock,
}));

describe('fetchGroupedHistoryProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('coalesces concurrent requests for the same history scope', async () => {
    let resolveRequest:
      | ((value: { projects: Array<{ project_id: string }> }) => void)
      | undefined;
    proxyFetchGetMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const first = fetchGroupedHistoryProjects({ spaceId: 'space_one' });
    const second = fetchGroupedHistoryProjects({ spaceId: 'space_one' });

    expect(proxyFetchGetMock).toHaveBeenCalledTimes(1);
    resolveRequest?.({ projects: [{ project_id: 'project_one' }] });

    await expect(first).resolves.toEqual([{ project_id: 'project_one' }]);
    await expect(second).resolves.toEqual([{ project_id: 'project_one' }]);
  });
});
