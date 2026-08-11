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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchPostMock } = vi.hoisted(() => ({
  fetchPostMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchPost: fetchPostMock,
}));

import {
  decideHumanInteraction,
  humanInteractionDecisionPath,
} from './humanInteractionApi';

describe('local HumanInteraction API', () => {
  beforeEach(() => {
    fetchPostMock.mockReset();
  });

  it('uses the unprefixed FastAPI Run decision route', async () => {
    fetchPostMock.mockResolvedValue({ status: 'approved' });

    await decideHumanInteraction(
      {
        interaction_id: 'interaction / 1',
        interaction_type: 'approval',
        run_id: 'run / 1',
        version: 2,
        action_digest: 'a'.repeat(64),
      },
      {
        decisionRequestId: 'decision-1',
        decision: { approved: true },
        actorId: 'user-1',
      }
    );

    expect(fetchPostMock).toHaveBeenCalledWith(
      '/runs/run%20%2F%201/interactions/interaction%20%2F%201/decisions',
      expect.objectContaining({
        decision_request_id: 'decision-1',
        expected_version: 2,
        source: 'desktop',
      })
    );
  });

  it('shares the same route builder with the Remote Control bridge', () => {
    expect(humanInteractionDecisionPath('run-1', 'interaction-1')).toBe(
      '/runs/run-1/interactions/interaction-1/decisions'
    );
  });
});
