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
  acceptCanonicalRunEvent,
  admitDurableRunResume,
  buildUploadRequestId,
  canonicalRunEventToLegacyMessage,
  collectTaskUploadFiles,
  createCanonicalRunEventCursor,
  createChatStoreInstance,
  extractAgentMessageContent,
  hasLegacyReplayUnavailableMessage,
  hasProjectedHumanInteraction,
  mergeFileInfoLists,
  normalizeTaskArtifactFileList,
  removeResolvedInteractionMessages,
  shouldAppendTaskForConfirmedEvent,
} from '@/store/chatStore';
import { describe, expect, it, vi } from 'vitest';

describe('canonical Run replay projection', () => {
  it('deduplicates the exact localized legacy replay failure', () => {
    const localizedMessage =
      'Diese ältere Aufgabe kann nicht wiedergegeben werden. Die gespeicherten Wiedergabedaten konnten nicht geladen werden.';

    expect(
      hasLegacyReplayUnavailableMessage(
        [{ role: 'agent', content: localizedMessage }],
        localizedMessage
      )
    ).toBe(true);
    expect(
      hasLegacyReplayUnavailableMessage(
        [
          {
            role: 'agent',
            content:
              'Unable to replay this legacy task. The saved playback data could not be loaded.',
          },
        ],
        localizedMessage
      )
    ).toBe(true);
    expect(
      hasLegacyReplayUnavailableMessage(
        [
          {
            role: 'agent',
            content:
              'Diese Aufgabe konnte aus einem anderen Grund nicht starten.',
          },
        ],
        localizedMessage
      )
    ).toBe(false);
  });

  it('keeps structured interaction payloads out of Message.content', () => {
    expect(
      extractAgentMessageContent({
        interaction_id: 'approval-1',
        interaction_type: 'approval',
        title: 'Allow write?',
      })
    ).toBe('');
    expect(
      extractAgentMessageContent({
        interaction_id: 'question-1',
        question: 'Which account?',
      })
    ).toBe('Which account?');
    expect(extractAgentMessageContent('legacy text')).toBe('legacy text');
  });

  it('surfaces Resume admission failures before execution starts', async () => {
    const error = Object.assign(new Error('Unsafe tool outcome'), {
      status: 409,
    });
    const post = vi.fn().mockRejectedValue(error);

    await expect(
      admitDurableRunResume('run/unsafe', 'resume-request-1', post)
    ).rejects.toBe(error);
    expect(post).toHaveBeenCalledWith('/runs/run%2Funsafe/resume', {
      request_id: 'resume-request-1',
      reason: 'explicit_resume',
    });
  });

  it('unwraps legacy UI events and projects durable interaction decisions', () => {
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'legacy.end',
        legacy_step: 'end',
        payload: { message: 'finished' },
        created_at: 1_786_026_414.75,
      })
    ).toEqual({
      step: 'end',
      data: { message: 'finished' },
      timestamp: 1_786_026_414.75,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'approval.decided',
        legacy_step: null,
        payload: {
          interaction_id: 'approval-1',
          decision: 'approved',
        },
        created_at: 1_786_026_415,
      })
    ).toEqual({
      step: 'human_reply',
      data: {
        interaction_id: 'approval-1',
        decision: 'approved',
        __durable_interaction_resolution: true,
      },
      timestamp: 1_786_026_415,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'interaction.resolved',
        legacy_step: null,
        payload: {
          interaction_id: 'question-2',
          decision: { reply: 'done' },
        },
        created_at: 1_786_026_416,
      })
    ).toEqual({
      step: 'human_reply',
      data: {
        interaction_id: 'question-2',
        decision: { reply: 'done' },
        __durable_interaction_resolution: true,
      },
      timestamp: 1_786_026_416,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'artifact.manifest.finalized',
        legacy_step: null,
        payload: {
          scan_status: 'complete',
          artifacts: [
            {
              path: '/workspace/report.csv',
              relativePath: 'report.csv',
              filename: 'report.csv',
            },
          ],
        },
        created_at: 1_786_026_414.9,
      })
    ).toEqual({
      step: 'artifact_manifest',
      data: {
        scan_status: 'complete',
        artifacts: [
          {
            path: '/workspace/report.csv',
            relativePath: 'report.csv',
            filename: 'report.csv',
          },
        ],
      },
      timestamp: 1_786_026_414.9,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'run.failed',
        legacy_step: null,
        payload: {
          error_type: 'InvalidRunTransitionError',
          message: 'An unresolved Tool outcome prevents completion.',
        },
        created_at: 1_786_026_417,
      })
    ).toEqual({
      step: 'error',
      data: {
        error_type: 'InvalidRunTransitionError',
        message: 'An unresolved Tool outcome prevents completion.',
      },
      timestamp: 1_786_026_417,
    });
    expect(
      canonicalRunEventToLegacyMessage({
        event_type: 'tool.completed',
        legacy_step: null,
        payload: { outcome: 'completed' },
      })
    ).toBeNull();
    expect(
      canonicalRunEventToLegacyMessage({
        run_id: 'run-1',
        after_sequence: 3,
      })
    ).toBeNull();
  });

  it('keeps Resume attempts of one local durable Run in one task', () => {
    expect(
      shouldAppendTaskForConfirmedEvent({
        projectId: 'project-1',
        question: 'Resume from persisted context',
        messageContent: 'Original prompt',
        skipFirstConfirm: false,
        replaySource: 'local_durable',
      })
    ).toBe(false);

    // A later confirmed frame on the legacy cloud Project stream still marks
    // a genuinely new Run and retains the migration behaviour.
    expect(
      shouldAppendTaskForConfirmedEvent({
        projectId: 'project-1',
        question: 'A new follow-up',
        messageContent: 'Original prompt',
        skipFirstConfirm: false,
        replaySource: 'cloud',
      })
    ).toBe(true);
  });

  it('removes only the message for the resolved interaction', () => {
    const messages = [
      {
        id: 'approval-card',
        role: 'agent' as const,
        content: 'Approve?',
        interaction: {
          interaction_id: 'approval-1',
          interaction_type: 'approval' as const,
          run_id: 'run-1',
          version: 0,
        },
      },
      {
        id: 'other-card',
        role: 'agent' as const,
        content: 'Other question',
        interaction: {
          interaction_id: 'question-2',
          interaction_type: 'question' as const,
          run_id: 'run-1',
          version: 0,
        },
      },
    ];

    expect(removeResolvedInteractionMessages(messages, 'approval-1')).toEqual([
      messages[1],
    ]);
  });

  it('keeps resolved interaction ids monotonic and removes replayed cards', () => {
    const store = createChatStoreInstance();
    store.getState().create('run-1');
    const approval = {
      id: 'approval-card',
      role: 'agent' as const,
      content: 'Approve?',
      step: 'ask',
      interaction: {
        interaction_id: 'approval-1',
        interaction_type: 'approval' as const,
        run_id: 'run-1',
        version: 0,
      },
    };
    store.getState().addMessages('run-1', approval);

    store.getState().markHumanInteractionResolved('run-1', 'approval-1');
    store.getState().markHumanInteractionResolved('run-1', 'approval-1');

    expect(store.getState().tasks['run-1'].messages).toEqual([]);
    expect(store.getState().tasks['run-1'].resolvedInteractionIds).toEqual([
      'approval-1',
    ]);
    expect(
      hasProjectedHumanInteraction(
        store.getState().tasks['run-1'],
        'approval-1'
      )
    ).toBe(true);
  });

  it('deduplicates a pending interaction across message and queued ASK lanes', () => {
    const interaction = {
      interaction_id: 'approval-1',
      interaction_type: 'approval' as const,
      run_id: 'run-1',
      version: 0,
    };
    const message = {
      id: 'approval-card',
      role: 'agent' as const,
      content: 'Approve?',
      interaction,
    };

    expect(
      hasProjectedHumanInteraction(
        { messages: [message], askList: [], resolvedInteractionIds: [] },
        interaction.interaction_id
      )
    ).toBe(true);
    expect(
      hasProjectedHumanInteraction(
        { messages: [], askList: [message], resolvedInteractionIds: [] },
        interaction.interaction_id
      )
    ).toBe(true);
    expect(
      hasProjectedHumanInteraction(
        { messages: [], askList: [], resolvedInteractionIds: [] },
        interaction.interaction_id
      )
    ).toBe(false);
  });

  it('deduplicates reconnect replay by sequence and event_id', () => {
    const cursor = createCanonicalRunEventCursor();
    const first = { sequence: 1, event_id: 'event-1' };

    expect(acceptCanonicalRunEvent(cursor, first, '1')).toBe(true);
    expect(acceptCanonicalRunEvent(cursor, first, '1')).toBe(false);
    expect(
      acceptCanonicalRunEvent(cursor, {
        sequence: 2,
        event_id: 'event-1',
      })
    ).toBe(false);
    expect(
      acceptCanonicalRunEvent(cursor, {
        sequence: 2,
        event_id: 'event-2',
      })
    ).toBe(true);
    expect(cursor.lastSequence).toBe(2);
  });

  it('keeps same-named files when their workspace-relative paths differ', () => {
    const artifacts = Array.from({ length: 21 }, (_, index) => ({
      filename: 'index.html',
      path: `/workspace/chapter-2/lesson-${index + 1}/index.html`,
      relativePath: `chapter-2/lesson-${index + 1}/index.html`,
      changeType: 'generated',
    }));

    const files = normalizeTaskArtifactFileList(artifacts);

    expect(files).toHaveLength(21);
    expect(files[0]).toEqual(
      expect.objectContaining({
        relativePath: 'chapter-2/lesson-1/index.html',
        artifactChange: 'generated',
      })
    );
    expect(files[20]).toEqual(
      expect.objectContaining({
        relativePath: 'chapter-2/lesson-21/index.html',
        artifactChange: 'generated',
      })
    );

    expect(mergeFileInfoLists([], files)).toHaveLength(21);

    expect(
      mergeFileInfoLists(
        [
          {
            name: 'index.html',
            type: 'html',
            path: '/workspace/chapter-2/lesson-1/index.html',
          },
        ],
        [files[0]]
      )
    ).toHaveLength(1);
  });

  it('keeps Cloud-safe Artifact metadata when the local path is redacted', () => {
    const files = normalizeTaskArtifactFileList([
      {
        artifact_id: 'art-cloud-1',
        filename: 'report.csv',
        relativePath: 'reports/report.csv',
        changeType: 'generated',
        uploadPolicy: 'agent_generated',
        localPathAvailable: false,
      },
    ]);

    expect(files).toEqual([
      expect.objectContaining({
        artifactId: 'art-cloud-1',
        name: 'report.csv',
        path: '',
        relativePath: 'reports/report.csv',
        localPathAvailable: false,
      }),
    ]);
  });

  it('keeps canonical Artifact uploads out of the Renderer lane', () => {
    const candidates = collectTaskUploadFiles(
      [],
      [],
      [],
      [
        {
          artifactId: 'art-generated',
          name: 'generated.csv',
          type: 'csv',
          path: '/workspace/generated.csv',
          uploadPolicy: 'agent_generated',
        },
        {
          artifactId: 'art-local',
          name: 'private.csv',
          type: 'csv',
          path: '/workspace/private.csv',
          uploadPolicy: 'metadata_only',
        },
      ]
    );

    expect(candidates).toEqual([]);
  });

  it('separates a CAMEL log basename from its logical path metadata', () => {
    const candidates = collectTaskUploadFiles(
      [
        {
          path: '/Users/test/.eigent/camel_logs/agent-1/conv.json',
          name: 'conv.json',
          relativePath: 'agent-1',
          source: 'camel_log',
        },
      ],
      [],
      []
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        uploadName: 'conv.json',
        source: 'camel_log',
        logicalPath: 'agent-1/conv.json',
      }),
    ]);
    expect(candidates[0].uploadName).not.toContain('/');
  });

  it('derives a bounded idempotency key without exposing the local path', async () => {
    const file = {
      path: '/Users/alice/private/camel_logs/agent-1/conv.json',
      source: 'camel_log' as const,
      logicalPath: 'agent-1/conv.json',
    };

    const first = await buildUploadRequestId('project-1', file);
    const replay = await buildUploadRequestId('project-1', file);

    expect(first).toBe(replay);
    expect(first).toHaveLength(83);
    expect(first).not.toContain('alice');
    expect(first).not.toContain('conv.json');
  });

  it('matches URL-encoded stream paths and legacy x-prefixed paths', () => {
    expect(
      mergeFileInfoLists(
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: '/files/stream?path=reports%2Freport.csv&project_id=1',
            isRemote: true,
          },
        ],
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: '/workspace/reports/report.csv',
            relativePath: 'reports/report.csv',
            artifactChange: 'changed',
          },
        ]
      )
    ).toMatchObject([
      {
        path: '/files/stream?path=reports%2Freport.csv&project_id=1',
        artifactChange: 'changed',
      },
    ]);

    expect(
      mergeFileInfoLists(
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: 'x:/Users/test/report.csv',
          },
        ],
        [
          {
            name: 'report.csv',
            type: 'csv',
            path: '/Users/test/report.csv',
          },
        ]
      )
    ).toHaveLength(1);
  });
});
