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
  selectEventAutomationSource,
  selectLegacyAutomationSource,
} from '@/components/Session/HeaderBox/sessionAutomationSource';
import type { ChatMessageNode } from '@/lib/projector/chat';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

function eventMessage(
  id: string,
  runId: string,
  runSequence: number,
  role: ChatMessageNode['role'],
  purpose: ChatMessageNode['purpose'],
  content: string
): ChatMessageNode {
  return {
    id,
    eventId: id,
    projectId: 'project-1',
    runId,
    runSequence,
    cloudCursor: null,
    createdAt: `2026-09-23T10:00:0${runSequence}.000Z`,
    eventType: 'test.message',
    legacyStep: null,
    kind: 'message',
    role,
    purpose,
    content,
    status: 'complete',
  };
}

describe('Session automation source', () => {
  it('uses the latest completed event Run and never crosses Sessions', () => {
    const snapshot = {
      view: {
        projectId: 'project-1',
        runs: { 'run-3': { runId: 'run-3', status: 'running' } },
      },
      chat: {
        nodes: [
          eventMessage('q1', 'run-1', 1, 'user', 'query', 'Earlier request'),
          eventMessage(
            'f1',
            'run-1',
            2,
            'assistant',
            'final',
            'Earlier result'
          ),
          eventMessage('q2', 'run-2', 3, 'user', 'query', 'Latest request'),
          eventMessage('f2', 'run-2', 4, 'assistant', 'final', 'Latest result'),
          eventMessage('q3', 'run-3', 5, 'user', 'query', 'Running request'),
          eventMessage(
            'f3',
            'run-3',
            6,
            'assistant',
            'final',
            'Unfinished result'
          ),
        ],
      },
    } as ProjectEventStoreSnapshot;

    expect(selectEventAutomationSource(snapshot, 'project-1')).toEqual({
      taskPrompt: 'Latest request',
      resultContent: 'Latest result',
    });
    expect(selectEventAutomationSource(snapshot, 'project-2')).toBeNull();
  });

  it('uses the latest legacy final and ignores an ASK reply as a Task prompt', () => {
    const messages: Message[] = [
      { id: 'q1', role: 'user', content: 'Original request' },
      { id: 'ask', role: 'agent', step: AgentStep.ASK, content: 'Which date?' },
      { id: 'reply', role: 'user', content: 'Tomorrow' },
      {
        id: 'final',
        role: 'agent',
        step: AgentStep.END,
        content: 'Final result',
      },
      { id: 'q2', role: 'user', content: 'New request still running' },
    ];

    expect(
      selectLegacyAutomationSource([{ tasks: { task: { messages } } }])
    ).toEqual({
      taskPrompt: 'Original request',
      resultContent: 'Final result',
    });
  });
});
