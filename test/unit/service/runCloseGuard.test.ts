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

import { assessCloseRunState } from '@/service/runCloseGuard';
import { describe, expect, it, vi } from 'vitest';

const response = (status?: string) => ({
  runs: status ? [{ run_id: `run-${status}`, status }] : [],
});

describe('close Run guard', () => {
  it('deduplicates Projects and returns idle when no execution is active', async () => {
    const fetchRuns = vi.fn().mockResolvedValue(response());

    await expect(
      assessCloseRunState({
        projectIds: ['project-1', 'project-1'],
        legacyActive: false,
        fetchRuns,
      })
    ).resolves.toBe('idle');

    expect(fetchRuns).toHaveBeenCalledOnce();
    expect(fetchRuns).toHaveBeenCalledWith('project-1', undefined);
  });

  it.each([
    [false, 'canonical-durable'],
    [true, 'mixed'],
  ] as const)(
    'classifies a canonical active Run with legacyActive=%s as %s',
    async (legacyActive, expected) => {
      await expect(
        assessCloseRunState({
          projectIds: ['project-1'],
          legacyActive,
          fetchRuns: vi.fn().mockResolvedValue(response('waiting_for_user')),
        })
      ).resolves.toBe(expected);
    }
  );

  it('retains the legacy execution class when the durable registry is idle', async () => {
    await expect(
      assessCloseRunState({
        projectIds: [],
        legacyActive: true,
        fetchRuns: vi.fn(),
      })
    ).resolves.toBe('legacy-stream');
  });

  it('rejects malformed or unfiltered registry results so callers fail closed', async () => {
    await expect(
      assessCloseRunState({
        projectIds: ['project-1'],
        legacyActive: false,
        fetchRuns: vi.fn().mockResolvedValue(response('completed')),
      })
    ).rejects.toThrow('ignored its active-status filter');
  });
});
