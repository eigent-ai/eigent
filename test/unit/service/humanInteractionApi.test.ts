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

const { fetchGetMock, fetchPostMock } = vi.hoisted(() => ({
  fetchGetMock: vi.fn(),
  fetchPostMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  fetchGet: fetchGetMock,
  fetchPost: fetchPostMock,
}));

import {
  decideHumanInteraction,
  getHumanInteractionReceipt,
  humanInteractionDecisionPath,
  invalidatePendingHumanInteractions,
  isHumanInteractionStillPending,
  type HumanInteractionPayload,
} from '@/service/humanInteractionApi';

describe('local HumanInteraction API', () => {
  beforeEach(() => {
    fetchPostMock.mockReset();
    fetchGetMock.mockReset();
    invalidatePendingHumanInteractions();
  });

  it('reads only the matching durable receipt and never classifies cancellation as expiry', async () => {
    const interaction: HumanInteractionPayload = {
      interaction_id: 'old',
      run_id: 'run-1',
      interaction_type: 'approval',
    };
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      interactions: [
        { interaction_id: 'old', status: 'cancelled', attempt_id: 'a-1' },
        { interaction_id: 'new', status: 'expired', attempt_id: 'a-2' },
      ],
      approvals: [
        {
          approval_id: 'old',
          decision: { reason: 'tool_terminal_before_dispatch' },
        },
        { approval_id: 'new', decision: { reason: 'approval_expired' } },
      ],
      attempts: [
        { attempt_id: 'a-1', terminal_reason: 'error' },
        { attempt_id: 'a-2', terminal_reason: 'approval_expired' },
      ],
    });
    // The card names why the owning Attempt stopped, never the raw reason.
    await expect(getHumanInteractionReceipt(interaction)).resolves.toEqual({
      status: 'cancelled',
      reason: 'tool_terminal_before_dispatch',
      terminal_reason: 'error',
    });
    fetchGetMock.mockResolvedValue({
      run_id: 'other',
      interactions: [{ interaction_id: 'old', status: 'expired' }],
    });
    await expect(getHumanInteractionReceipt(interaction)).resolves.toBeNull();
  });

  it('shares concurrent receipt reads without caching later recovery state', async () => {
    const interaction: HumanInteractionPayload = {
      interaction_id: 'old',
      run_id: 'run-1',
      interaction_type: 'approval',
    };
    fetchGetMock.mockResolvedValue({
      run_id: 'run-1',
      interactions: [{ interaction_id: 'old', status: 'cancelled' }],
    });
    await Promise.all([
      getHumanInteractionReceipt(interaction),
      getHumanInteractionReceipt(interaction),
    ]);
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
    await getHumanInteractionReceipt(interaction);
    expect(fetchGetMock).toHaveBeenCalledTimes(2);
  });

  it('cannot revalidate a retired approval or a passed journal deadline', async () => {
    const interaction: HumanInteractionPayload = {
      interaction_id: 'old',
      run_id: 'run-1',
      interaction_type: 'approval',
      version: 0,
    };
    fetchGetMock.mockResolvedValue({
      interactions: [
        {
          interaction_id: 'old',
          status: 'requested',
          version: 0,
          expires_at: 1,
        },
      ],
    });
    await expect(isHumanInteractionStillPending(interaction)).resolves.toBe(
      false
    );
    await expect(
      isHumanInteractionStillPending({
        ...interaction,
        receipt: { runStatus: 'interrupted' },
      })
    ).resolves.toBe(false);
    await expect(
      isHumanInteractionStillPending({ ...interaction, status: 'cancelled' })
    ).resolves.toBe(false);
    expect(fetchGetMock).toHaveBeenCalledTimes(1);
  });

  it('uses the unprefixed FastAPI Run decision route', async () => {
    fetchPostMock.mockImplementation((url, body) =>
      Promise.resolve({
        run_id: decodeURIComponent(url.split('/')[2]),
        interaction_id: decodeURIComponent(url.split('/')[4]),
        status: 'resolved',
        version: body.expected_version + 1,
        response: body.decision,
        action_digest: body.action_digest,
      })
    );

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
        decision: { decision: 'approved', scope: 'once' },
        actorId: 'user-1',
      }
    );

    expect(fetchPostMock).toHaveBeenCalledWith(
      '/runs/run%20%2F%201/interactions/interaction%20%2F%201/decisions',
      expect.objectContaining({
        decision_request_id: 'decision-1',
        expected_version: 2,
        source: 'desktop',
      }),
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('shares the same route builder with the Remote Control bridge', () => {
    expect(humanInteractionDecisionPath('run-1', 'interaction-1')).toBe(
      '/runs/run-1/interactions/interaction-1/decisions'
    );
  });

  it('revalidates only the exact pending durable interaction', async () => {
    fetchGetMock.mockResolvedValue({
      interactions: [
        {
          interaction_id: 'interaction-1',
          status: 'requested',
          version: 2,
          action_digest: 'a'.repeat(64),
        },
      ],
    });

    await expect(
      isHumanInteractionStillPending({
        interaction_id: 'interaction-1',
        interaction_type: 'approval',
        run_id: 'run / 1',
        version: 2,
        action_digest: 'a'.repeat(64),
      })
    ).resolves.toBe(true);
    expect(fetchGetMock).toHaveBeenCalledWith(
      '/runs/run%20%2F%201/interactions?status=pending',
      undefined,
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('accepts the lightweight pending-list shape while decision POST still enforces the digest', async () => {
    fetchGetMock.mockResolvedValue({
      interactions: [
        {
          interaction_id: 'interaction-1',
          status: 'requested',
          version: 2,
        },
      ],
    });

    await expect(
      isHumanInteractionStillPending({
        interaction_id: 'interaction-1',
        interaction_type: 'approval',
        run_id: 'run-1',
        version: 2,
        action_digest: 'a'.repeat(64),
      })
    ).resolves.toBe(true);
  });

  it('does not unlock a stale version of a pending interaction', async () => {
    fetchGetMock.mockResolvedValue({
      interactions: [
        {
          interaction_id: 'interaction-1',
          status: 'requested',
          version: 3,
          action_digest: 'a'.repeat(64),
        },
      ],
    });

    await expect(
      isHumanInteractionStillPending({
        interaction_id: 'interaction-1',
        interaction_type: 'approval',
        run_id: 'run-1',
        version: 2,
        action_digest: 'a'.repeat(64),
      })
    ).resolves.toBe(false);
  });

  it('deduplicates concurrent pending reads for cards from the same Run', async () => {
    fetchGetMock.mockResolvedValue({ interactions: [] });
    const payload = {
      interaction_id: 'interaction-1',
      interaction_type: 'approval' as const,
      run_id: 'run-1',
      version: 0,
    };

    await Promise.all([
      isHumanInteractionStillPending(payload),
      isHumanInteractionStillPending(payload),
      isHumanInteractionStillPending(payload),
    ]);

    expect(fetchGetMock).toHaveBeenCalledTimes(1);
  });

  it('posts a decision to the local durable Run route', async () => {
    fetchPostMock.mockImplementation((url, body) =>
      Promise.resolve({
        run_id: decodeURIComponent(url.split('/')[2]),
        interaction_id: decodeURIComponent(url.split('/')[4]),
        status: 'resolved',
        version: body.expected_version + 1,
        response: body.decision,
        action_digest: body.action_digest,
      })
    );
    const interaction: HumanInteractionPayload = {
      interaction_id: 'approval:todo/write',
      interaction_type: 'approval',
      run_id: 'run/123',
      version: 4,
      action_digest: 'digest-1',
    };

    await decideHumanInteraction(interaction, {
      decisionRequestId: 'decision-1',
      decision: { decision: 'approved', scope: 'once' },
      actorId: 42,
    });

    expect(fetchPostMock).toHaveBeenCalledWith(
      '/runs/run%2F123/interactions/approval%3Atodo%2Fwrite/decisions',
      {
        decision_request_id: 'decision-1',
        decision: { decision: 'approved', scope: 'once' },
        expected_version: 4,
        action_digest: 'digest-1',
        actor_type: 'user',
        actor_id: '42',
        source: 'desktop',
        continue_active_attempt: true,
      },
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('rejects an interaction without a durable Run id', async () => {
    await expect(
      decideHumanInteraction(
        {
          interaction_id: 'interaction-1',
          interaction_type: 'approval',
        },
        {
          decisionRequestId: 'decision-1',
          decision: { decision: 'approved', scope: 'once' },
        }
      )
    ).rejects.toThrow('Missing durable Run id');

    expect(fetchPostMock).not.toHaveBeenCalled();
  });
});
