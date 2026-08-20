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
  composeTimelineRuns,
  humanCallTitle,
  interactionFamily,
  segmentTimelineRows,
  toTimelineCall,
  type TimelineSegment,
} from '@/lib/projector/chat/presentation';
import type { ChatProjectionNode } from '@/lib/projector/chat/types';
import { beforeEach, describe, expect, it } from 'vitest';

const base = {
  projectId: 'project-1',
  runId: 'run-1',
  cloudCursor: 1,
  legacyStep: null,
} as const;

let sequence = 0;

function narration(content: string, agentName?: string): ChatProjectionNode {
  sequence += 1;
  const id = `narration-${sequence}`;
  return {
    ...base,
    kind: 'message',
    id,
    eventId: id,
    eventType: 'message.completed',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    role: 'assistant',
    purpose: 'narration',
    status: 'complete',
    content,
    agentName,
  };
}

function tool(
  toolkitName: string,
  methodName: string,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'activity' }>> = {}
): ChatProjectionNode {
  sequence += 1;
  const id = `tool-${sequence}`;
  return {
    ...base,
    kind: 'activity',
    id,
    eventId: id,
    eventType: 'tool.completed',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    activityType: 'tool',
    phase: 'completed',
    status: 'completed',
    title: `${toolkitName} · ${methodName}`,
    toolCallId: id,
    toolkitName,
    methodName,
    ...overrides,
  } as ChatProjectionNode;
}

function interaction(
  interactionType: string,
  overrides: Partial<Extract<ChatProjectionNode, { kind: 'interaction' }>> = {}
): ChatProjectionNode {
  sequence += 1;
  const id = `interaction-${sequence}`;
  return {
    ...base,
    kind: 'interaction',
    id,
    eventId: id,
    eventType: 'interaction.resolved',
    runSequence: sequence,
    createdAt: `2026-08-19T00:00:${String(sequence).padStart(2, '0')}Z`,
    interactionId: id,
    interactionType,
    status: 'responded',
    prompt: 'Proceed?',
    response: 'approved',
    ...overrides,
  } as ChatProjectionNode;
}

function segmentsOf(nodes: ChatProjectionNode[]) {
  const [run] = composeTimelineRuns(nodes);
  return segmentTimelineRows(run!.traceRows);
}

function onlySegments(nodes: ChatProjectionNode[]): TimelineSegment[] {
  return segmentsOf(nodes).filter(
    (item): item is TimelineSegment => item.kind === 'segment'
  );
}

describe('timeline segmentation', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('groups a narration with the calls that followed it', () => {
    const segments = onlySegments([
      narration('I will inspect the repository.'),
      tool('File Toolkit', 'read_file'),
      tool('File Toolkit', 'read_file'),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.narration).toBe('I will inspect the repository.');
    expect(segments[0]!.calls).toHaveLength(2);
    expect(segments[0]!.label).toBe('Read · 2 events');
    expect(segments[0]!.boundaryReason).toBe('narration');
  });

  it('keeps every derived segment marked as derived until steps are authored', () => {
    const segments = onlySegments([tool('File Toolkit', 'read_file')]);
    expect(segments.every((segment) => segment.source === 'derived')).toBe(
      true
    );
  });

  it('starts a new segment when the toolkit changes', () => {
    const segments = onlySegments([
      tool('File Toolkit', 'read_file'),
      tool('Search Toolkit', 'web_search'),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[1]!.boundaryReason).toBe('toolkit_change');
    expect(segments[0]!.label).toBe('Read · 1 event');
    expect(segments[1]!.label).toBe('Searched · 1 event');
  });

  it('keeps differently titled calls from one toolkit in the same segment', () => {
    const segments = onlySegments([
      tool('File Toolkit', 'read_file', { title: 'Read the first file' }),
      tool('File Toolkit', 'read_file', { title: 'Read the second file' }),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.calls).toHaveLength(2);
  });

  it('falls back to a plain count when a segment mixes methods', () => {
    const segments = onlySegments([
      tool('File Toolkit', 'read_file'),
      tool('File Toolkit', 'write_file'),
    ]);

    expect(segments).toHaveLength(1);
    expect(segments[0]!.label).toBe('2 events');
  });

  it('starts a new segment when the agent changes', () => {
    const segments = onlySegments([
      narration('Alpha starts.', 'Alpha Agent'),
      narration('Beta continues.', 'Beta Agent'),
    ]);

    expect(segments.map((segment) => segment.agentName)).toEqual([
      'Alpha Agent',
      'Beta Agent',
    ]);
  });

  it('treats work-log progress as narration rather than a call', () => {
    const progress: ChatProjectionNode = {
      ...base,
      kind: 'activity',
      id: 'progress-1',
      eventId: 'progress-1',
      eventType: 'work_log.progress',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:01Z',
      activityType: 'work_log',
      phase: 'progress',
      status: 'running',
      title: 'Searching for README files',
    };

    const segments = onlySegments([progress]);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.narration).toBe('Searching for README files');
    expect(segments[0]!.calls).toHaveLength(0);
  });

  it('breaks a segment at a human interaction instead of folding it in', () => {
    const items = segmentsOf([
      tool('File Toolkit', 'read_file'),
      interaction('approval'),
      tool('File Toolkit', 'write_file'),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      'segment',
      'interrupt',
      'segment',
    ]);
  });

  it('opens a failed segment and folds every other one', async () => {
    const { segmentDefaultsOpen } =
      await import('@/lib/projector/chat/presentation');
    const [failed] = onlySegments([
      tool('File Toolkit', 'write_file', { status: 'failed' }),
    ]);
    const [running] = onlySegments([
      tool('File Toolkit', 'read_file', { status: 'running' }),
    ]);

    expect(segmentDefaultsOpen(failed!)).toBe(true);
    expect(segmentDefaultsOpen(running!)).toBe(false);
  });
});

describe('timeline calls', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('sorts the backend interaction vocabulary into three families', () => {
    expect(interactionFamily('approval')).toBe('authorize');
    expect(interactionFamily('credential_binding')).toBe('authorize');
    expect(interactionFamily('diff_review')).toBe('choose');
    expect(interactionFamily('question')).toBe('ask');
    // An unrecognized future type must not claim to be a permission.
    expect(interactionFamily('some_future_type')).toBe('ask');
  });

  it('titles a human call with the same executor grammar as a tool call', () => {
    const [run] = composeTimelineRuns([
      interaction('approval', { response: 'approved' }),
    ]);
    const call = toTimelineCall(run!.traceRows[0]!)!;

    expect(call.executor).toBe('human');
    expect(call.title).toBe('You · Allowed');
    expect(call.inputLabel).toBe('Requested');
    expect(call.outputLabel).toBe('Decision');
  });

  it('distinguishes a rejection from an approval', () => {
    const request = {
      ...base,
      kind: 'interaction' as const,
      id: 'i-1',
      eventId: 'i-1',
      eventType: 'interaction.resolved',
      runSequence: 1,
      createdAt: '2026-08-19T00:00:00Z',
      interactionType: 'approval',
      status: 'responded' as const,
      response: 'rejected',
    };
    expect(humanCallTitle(request)).toBe('You · Rejected');
  });

  it('labels a pending request without exposing a decision', () => {
    const [run] = composeTimelineRuns([
      interaction('question', { status: 'requested', response: undefined }),
    ]);
    const call = toTimelineCall(run!.traceRows[0]!)!;

    expect(call.title).toBe('Input required');
    expect(call.status).toBe('pending');
    expect(call.emptyOutputText).toBe('Waiting for your response.');
  });
});
