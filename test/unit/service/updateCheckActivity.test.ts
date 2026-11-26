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

import { isLocalTaskRunning } from '@/service/updateCheckActivity';
import { hasAnyActiveLegacySSEConnection } from '@/store/chatStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/chatStore', () => ({
  hasAnyActiveLegacySSEConnection: vi.fn(() => false),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: { getState: vi.fn(() => ({ projects: {} })) },
}));

vi.mock('@/service/runCloseGuard', () => ({
  fetchActiveLocalExecution: vi.fn(),
}));

function withLegacyTask(status: string) {
  vi.mocked(useProjectRuntimeStore.getState).mockReturnValue({
    projects: {
      p1: {
        chatStores: {
          c1: {
            getState: () => ({
              tasks: { t1: { status, isPending: false, activeAsk: '' } },
            }),
          },
        },
      },
    },
  } as never);
}

describe('isLocalTaskRunning', () => {
  beforeEach(() => {
    vi.mocked(hasAnyActiveLegacySSEConnection).mockReturnValue(false);
    vi.mocked(useProjectRuntimeStore.getState).mockReturnValue({
      projects: {},
    } as never);
  });

  it('is true while a legacy stream is live, without asking Brain', async () => {
    vi.mocked(hasAnyActiveLegacySSEConnection).mockReturnValue(true);
    const fetchActive = vi.fn();
    await expect(isLocalTaskRunning({ fetchActive })).resolves.toBe(true);
    expect(fetchActive).not.toHaveBeenCalled();
  });

  it('is true while a legacy task is running', async () => {
    withLegacyTask('running');
    await expect(isLocalTaskRunning({ fetchActive: vi.fn() })).resolves.toBe(
      true
    );
  });

  it('follows the Run registry when no legacy task runs', async () => {
    withLegacyTask('finished');
    await expect(
      isLocalTaskRunning({ fetchActive: vi.fn(async () => ({ active: true })) })
    ).resolves.toBe(true);
    await expect(
      isLocalTaskRunning({
        fetchActive: vi.fn(async () => ({ active: false })),
      })
    ).resolves.toBe(false);
  });

  it('treats an unreachable or malformed registry as idle', async () => {
    await expect(
      isLocalTaskRunning({
        fetchActive: vi.fn(async () => {
          throw new Error('Brain not ready');
        }),
      })
    ).resolves.toBe(false);
    await expect(
      isLocalTaskRunning({ fetchActive: vi.fn(async () => ({}) as never) })
    ).resolves.toBe(false);
  });
});
