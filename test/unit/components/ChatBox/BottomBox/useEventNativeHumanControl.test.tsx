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

import {
  getStableDecisionRequestId,
  STABLE_DECISION_REQUEST_ID_CACHE_LIMIT,
  useEventNativeHumanControl,
} from '@/components/ChatBox/BottomBox/useEventNativeHumanControl';
import type {
  HumanControlInteraction,
  HumanControlProjectionState,
} from '@/lib/projector/control';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  projection: null as HumanControlProjectionState | null,
  decide: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock('@/hooks/useProjectEventView', () => ({
  useProjectHumanControlProjection: () => mocks.projection,
}));

vi.mock('@/service/humanInteractionApi', () => ({
  decideHumanInteraction: mocks.decide,
}));

vi.mock('@/service/humanInteractionEventReconciliation', () => ({
  reconcileHumanInteractionEvents: mocks.reconcile,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: { user_id: number }) => unknown) =>
    selector({ user_id: 42 }),
}));

function interaction(
  overrides: Partial<HumanControlInteraction> = {}
): HumanControlInteraction {
  return {
    interactionId: 'approval-1',
    interactionType: 'approval',
    status: 'requested',
    projectId: 'project-1',
    runId: 'run-1',
    sequence: 3,
    lastSequence: 3,
    cloudCursor: null,
    lastCloudCursor: null,
    requestEventId: 'request-1',
    requestSource: 'canonical',
    lastEventId: 'request-1',
    requestedAt: '2026-08-11T10:00:03.000Z',
    updatedAt: '2026-08-11T10:00:03.000Z',
    version: 0,
    approvalId: 'approval-1',
    actionDigest: 'digest-1',
    allowedScopes: ['once'],
    title: 'Allow todo_write?',
    prompt: 'The agent wants to write a todo.',
    agent: 'developer_agent',
    operation: 'mcp.tool.write',
    targetResources: [],
    displayArguments: {},
    ruleMatcher: null,
    options: [],
    fields: [],
    ...overrides,
  };
}

function projection(
  interactions: HumanControlInteraction[]
): HumanControlProjectionState {
  return {
    projectId: 'project-1',
    interactionById: Object.fromEntries(
      interactions.map((item) => [item.interactionId, item])
    ),
    orderedInteractionIds: interactions.map((item) => item.interactionId),
    seenEventIds: {},
  };
}

describe('useEventNativeHumanControl', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.decide.mockReset();
    mocks.reconcile.mockReset();
    mocks.decide.mockResolvedValue({ status: 'resolved' });
    mocks.reconcile.mockResolvedValue({ eventType: 'approval.decided' });
    mocks.projection = projection([]);
  });

  it('selects the oldest pending control only from the explicit active Run', () => {
    mocks.projection = projection([
      interaction({ interactionId: 'other-run', runId: 'run-2' }),
      interaction({ interactionId: 'oldest', sequence: 4 }),
      interaction({ interactionId: 'newer', sequence: 8 }),
    ]);

    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    expect(result.current.interaction?.interactionId).toBe('oldest');
    expect(result.current.pendingCount).toBe(2);
  });

  it('maps approval scopes exactly as offered and reconciles through durable events', async () => {
    mocks.projection = projection([
      interaction({ allowedScopes: ['once', 'organization', 'space'] }),
    ]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    expect(result.current.variant?.kind).toBe('approval');
    if (result.current.variant?.kind !== 'approval') throw new Error('variant');
    expect(
      result.current.variant.options.map((option) => option.scope)
    ).toEqual(['once', 'space']);
    expect(result.current.variant.header.eyebrow).toBe('Input required');
    expect(result.current.variant.header.title).toBe(
      'The agent wants to write a todo.'
    );
    expect(result.current.variant.header.description).toBeUndefined();

    act(
      () =>
        result.current.variant?.kind === 'approval' &&
        result.current.variant.onApprove('once')
    );

    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        interaction_id: 'approval-1',
        run_id: 'run-1',
        version: 0,
        action_digest: 'digest-1',
      }),
      {
        decisionRequestId: expect.any(String),
        decision: { decision: 'approved', scope: 'once' },
        actorId: 42,
      }
    );
    expect(mocks.reconcile).toHaveBeenCalledWith({
      projectId: 'project-1',
      runId: 'run-1',
      interactionId: 'approval-1',
      afterSequence: 3,
    });
    expect(result.current.phase).toBe('reconciling');
    expect(result.current.variant.submitting).toBe(true);
  });

  it('notifies compatibility state only after a durable resolution is loaded', async () => {
    const onDurableResolution = vi.fn();
    mocks.projection = projection([interaction()]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
        onDurableResolution,
      })
    );

    act(() => {
      if (result.current.variant?.kind === 'approval') {
        result.current.variant.onApprove('once');
      }
    });

    await waitFor(() => expect(onDurableResolution).toHaveBeenCalledOnce());
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      onDurableResolution.mock.invocationCallOrder[0]
    );
    expect(onDurableResolution).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: 'approval-1' })
    );
  });

  it('updates submission presentation immediately and restores it on failure', async () => {
    const onSubmissionStart = vi.fn();
    const onSubmissionFailure = vi.fn();
    mocks.projection = projection([interaction()]);
    mocks.decide.mockRejectedValueOnce(new Error('offline'));
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
        onSubmissionStart,
        onSubmissionFailure,
      })
    );

    act(() => {
      if (result.current.variant?.kind === 'approval') {
        result.current.variant.onApprove('once');
      }
    });

    expect(onSubmissionStart).toHaveBeenCalledOnce();
    expect(onSubmissionStart).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: 'approval-1' })
    );
    await waitFor(() => expect(onSubmissionFailure).toHaveBeenCalledOnce());
    expect(result.current.phase).toBe('idle');
    consoleError.mockRestore();
  });

  it('reconciles an already-resolved conflict instead of keeping a retry loop', async () => {
    const onDurableResolution = vi.fn();
    const onSubmissionFailure = vi.fn();
    const conflict = Object.assign(new Error('approval is already resolved'), {
      status: 409,
      response: { status: 409 },
    });
    mocks.projection = projection([interaction()]);
    mocks.decide.mockRejectedValueOnce(conflict);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
        onDurableResolution,
        onSubmissionFailure,
      })
    );

    act(() => {
      if (result.current.variant?.kind === 'approval') {
        result.current.variant.onApprove('once');
      }
    });

    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce());
    await waitFor(() => expect(onDurableResolution).toHaveBeenCalledOnce());
    expect(onSubmissionFailure).not.toHaveBeenCalled();
    expect(result.current.phase).toBe('reconciling');
  });

  it('does not use a legacy connection ordinal as a durable replay cursor', async () => {
    mocks.projection = projection([
      interaction({ sequence: 48, requestSource: 'chat_step_v1' }),
    ]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    act(() => {
      if (result.current.variant?.kind === 'approval') {
        result.current.variant.onApprove('once');
      }
    });

    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce());
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ afterSequence: 0 })
    );
  });

  it('keeps a failed decision retryable with the same request id across remount', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.projection = projection([interaction()]);
    mocks.decide
      .mockRejectedValueOnce(new Error('network response lost'))
      .mockResolvedValueOnce({ status: 'resolved' });

    const first = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );
    act(() => {
      if (first.result.current.variant?.kind === 'approval') {
        first.result.current.variant.onApprove('once');
      }
    });
    await waitFor(() => expect(first.result.current.submitError).toBeTruthy());
    const firstRequestId = mocks.decide.mock.calls[0][1].decisionRequestId;
    expect(first.result.current.phase).toBe('idle');
    first.unmount();

    const second = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );
    act(() => {
      if (second.result.current.variant?.kind === 'approval') {
        second.result.current.variant.onApprove('once');
      }
    });
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledTimes(2));

    expect(mocks.decide.mock.calls[1][1].decisionRequestId).toBe(
      firstRequestId
    );
    consoleError.mockRestore();
  });

  it('maps known controls and fails closed for unknown semantic types', () => {
    const cases = [
      interaction({
        interactionId: 'choice-1',
        interactionType: 'choice',
        options: [{ id: 'a', label: 'Branch A', value: { branch: 'a' } }],
      }),
      interaction({
        interactionId: 'form-1',
        interactionType: 'form',
        fields: [
          { id: 'reason', label: 'Reason', required: true, type: 'textarea' },
        ],
      }),
      interaction({
        interactionId: 'question-1',
        interactionType: 'question',
      }),
      interaction({
        interactionId: 'future-1',
        interactionType: 'future_review',
      }),
    ];

    const kinds = cases.map((item) => {
      mocks.projection = projection([item]);
      const hook = renderHook(() =>
        useEventNativeHumanControl({
          projectId: 'project-1',
          activeRunId: 'run-1',
        })
      );
      const kind = hook.result.current.variant?.kind;
      hook.unmount();
      return kind;
    });

    expect(kinds).toEqual(['selection', 'form', 'feedback', 'blocked']);
  });

  it('submits the backend merge-conflict options as a durable selection', async () => {
    mocks.projection = projection([
      interaction({
        interactionId: 'merge-conflict:abc',
        interactionType: 'merge_conflict',
        title: 'Agent changes need conflict resolution',
        targetResources: ['src/report.ts'],
        options: [
          { id: 'keep_run', label: 'Keep Run version', value: 'keep_run' },
          {
            id: 'take_agent',
            label: 'Use Agent version',
            value: 'take_agent',
          },
          { id: 'manual', label: 'Resolve manually', value: 'manual' },
        ],
      }),
    ]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    expect(result.current.variant?.kind).toBe('selection');
    act(() => {
      if (result.current.variant?.kind === 'selection') {
        result.current.variant.onSelectionChange(['take_agent']);
      }
    });
    await waitFor(() =>
      expect(
        result.current.variant?.kind === 'selection'
          ? result.current.variant.selectedIds
          : []
      ).toEqual(['take_agent'])
    );
    act(() => {
      if (result.current.variant?.kind === 'selection') {
        result.current.variant.onSubmit();
      }
    });

    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        interaction_id: 'merge-conflict:abc',
        interaction_type: 'merge_conflict',
        run_id: 'run-1',
      }),
      expect.objectContaining({
        decision: { option_id: 'take_agent', value: 'take_agent' },
      })
    );
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: 'merge-conflict:abc' })
    );
  });

  it('submits the backend question interaction as a durable reply', async () => {
    mocks.projection = projection([
      interaction({
        interactionId: 'question-1',
        interactionType: 'question',
        prompt: 'Which file should I update?',
        approvalId: undefined,
        actionDigest: undefined,
      }),
    ]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    expect(result.current.variant).toMatchObject({
      kind: 'feedback',
      presentation: 'question',
      header: {
        title: 'Question',
        description: 'Which file should I update?',
      },
    });
    if (result.current.variant?.kind !== 'feedback') throw new Error('variant');
    expect(result.current.variant.header.eyebrow).toBeUndefined();
    expect(result.current.variant.header.contextItems).toBeUndefined();
    expect(result.current.variant.header.details).toBeUndefined();

    act(() => {
      if (result.current.variant?.kind === 'feedback') {
        result.current.variant.onChange('src/report.ts');
      }
    });
    await waitFor(() =>
      expect(
        result.current.variant?.kind === 'feedback'
          ? result.current.variant.value
          : ''
      ).toBe('src/report.ts')
    );
    act(() => {
      if (result.current.variant?.kind === 'feedback') {
        result.current.variant.onSubmit();
      }
    });

    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        interaction_id: 'question-1',
        interaction_type: 'question',
      }),
      expect.objectContaining({ decision: { reply: 'src/report.ts' } })
    );
    expect(mocks.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: 'question-1' })
    );
  });

  it('blocks option interactions that omit backend-provided options', () => {
    mocks.projection = projection([
      interaction({
        interactionId: 'merge-conflict:empty',
        interactionType: 'merge_conflict',
        options: [],
      }),
    ]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    expect(result.current.variant).toMatchObject({ kind: 'blocked' });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('keeps diff review and credential binding fail-closed', () => {
    const kinds = ['diff_review', 'credential_binding'].map(
      (interactionType) => {
        mocks.projection = projection([
          interaction({
            interactionId: interactionType,
            interactionType,
          }),
        ]);
        const hook = renderHook(() =>
          useEventNativeHumanControl({
            projectId: 'project-1',
            activeRunId: 'run-1',
          })
        );
        const kind = hook.result.current.variant?.kind;
        hook.unmount();
        return kind;
      }
    );

    expect(kinds).toEqual(['blocked', 'blocked']);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('blocks password and unknown form fields instead of exposing text inputs', () => {
    const fieldTypes = ['password', 'file'];
    const kinds = fieldTypes.map((type, index) => {
      mocks.projection = projection([
        interaction({
          interactionId: `unsafe-form-${index}`,
          interactionType: 'form',
          fields: [
            {
              id: 'sensitive-value',
              label: 'Sensitive value',
              required: true,
              type,
            },
          ],
        }),
      ]);
      const hook = renderHook(() =>
        useEventNativeHumanControl({
          projectId: 'project-1',
          activeRunId: 'run-1',
        })
      );
      const variant = hook.result.current.variant;
      hook.unmount();
      return variant;
    });

    expect(kinds).toEqual([
      expect.objectContaining({ kind: 'blocked' }),
      expect.objectContaining({ kind: 'blocked' }),
    ]);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('does not submit a frontend-synthesized legacy interaction id', () => {
    mocks.projection = projection([
      interaction({
        interactionId: 'legacy:run-1:legacy-ask-1',
        interactionType: 'question',
        requestSource: 'chat_step_v1',
      }),
    ]);

    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    expect(result.current.variant).toMatchObject({ kind: 'blocked' });
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('does not expose controls when the owning Run is read-only', () => {
    mocks.projection = projection([interaction()]);
    const { result } = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
        enabled: false,
      })
    );

    expect(result.current.interaction).toBeNull();
    expect(result.current.variant).toBeNull();
    expect(result.current.pendingCount).toBe(0);
  });

  it('uses a new id when a retry changes the actual decision', () => {
    const approval = interaction();
    const approvedId = getStableDecisionRequestId('project-1', approval, {
      decision: 'approved',
      scope: 'once',
    });
    const rejectedId = getStableDecisionRequestId('project-1', approval, {
      decision: 'rejected',
      scope: 'once',
    });

    expect(rejectedId).not.toBe(approvedId);
  });

  it('bounds stable request ids in memory and session storage', () => {
    const decision = { decision: 'approved', scope: 'once' };
    const firstInteraction = interaction({ interactionId: 'cache-0' });
    const firstId = getStableDecisionRequestId(
      'project-1',
      firstInteraction,
      decision
    );

    for (
      let index = 1;
      index <= STABLE_DECISION_REQUEST_ID_CACHE_LIMIT;
      index += 1
    ) {
      getStableDecisionRequestId(
        'project-1',
        interaction({ interactionId: `cache-${index}` }),
        decision
      );
    }

    // One additional key stores the LRU index itself.
    expect(sessionStorage.length).toBeLessThanOrEqual(
      STABLE_DECISION_REQUEST_ID_CACHE_LIMIT + 1
    );
    expect(
      getStableDecisionRequestId('project-1', firstInteraction, decision)
    ).not.toBe(firstId);
  });

  it('releases cached request ids once the durable control is terminal', async () => {
    const decision = { decision: 'approved', scope: 'once' };
    const pending = interaction({ interactionId: 'terminal-cleanup' });
    const firstId = getStableDecisionRequestId('project-1', pending, decision);
    mocks.projection = projection([pending]);
    const hook = renderHook(() =>
      useEventNativeHumanControl({
        projectId: 'project-1',
        activeRunId: 'run-1',
      })
    );

    mocks.projection = projection([
      interaction({
        interactionId: 'terminal-cleanup',
        status: 'resolved',
        lastSequence: 4,
        lastEventId: 'decision-1',
      }),
    ]);
    await act(async () => hook.rerender());

    expect(getStableDecisionRequestId('project-1', pending, decision)).not.toBe(
      firstId
    );
  });
});
