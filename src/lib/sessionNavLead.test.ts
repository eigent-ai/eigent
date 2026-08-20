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

import type { ChatStore } from '@/store/chatStore';
import {
  AgentStep,
  ChatTaskStatus,
  SessionMode,
  TaskStatus,
} from '@/types/constants';
import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { getSessionNavLeadPresentation } from './sessionNavLead';

type TaskRow = ChatStore['tasks'][string];

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    messages: [],
    type: 'chat',
    status: ChatTaskStatus.PENDING,
    hasWaitComfirm: false,
    isTakeControl: false,
    taskInfo: [],
    taskRunning: [],
    isContextExceeded: false,
    sessionMode: SessionMode.SINGLE_AGENT,
    activeAsk: '',
    askList: [],
    resolvedInteractionIds: [],
    ...overrides,
  } as TaskRow;
}

describe('session nav lead presentation', () => {
  it('keeps the spinner while a single-agent run is executing', () => {
    const lead = getSessionNavLeadPresentation(
      task({ status: ChatTaskStatus.RUNNING })
    );
    expect(lead.kind).toBe('running');
    expect(lead.Icon).toBe(LoaderCircle);
    expect(lead.spin).toBe(true);
  });

  it('uses Alert with warning color when Human Toolkit is asking', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        activeAsk: 'Agents.single_agent',
      })
    );
    expect(lead.kind).toBe('hitl');
    expect(lead.Icon).toBe(AlertTriangle);
    expect(lead.iconClassName).toBe('!text-ds-icon-warning-default-default');
    expect(lead.spin).toBeUndefined();
  });

  it('uses Alert with warning color when the durable run is waiting for user', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        durableRunStatus: 'waiting_for_user',
      })
    );
    expect(lead.kind).toBe('hitl');
    expect(lead.Icon).toBe(AlertTriangle);
    expect(lead.iconClassName).toBe('!text-ds-icon-warning-default-default');
  });

  it('uses Alert with warning color for an unresolved ASK interaction', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        messages: [
          {
            id: 'ask-1',
            role: 'agent',
            content: 'Need a choice',
            step: AgentStep.ASK,
            interaction: {
              interaction_id: 'interaction-1',
              interaction_type: 'choice',
            } as Message['interaction'],
          },
        ],
      })
    );
    expect(lead.kind).toBe('hitl');
    expect(lead.Icon).toBe(AlertTriangle);
  });

  it('does not keep the Alert after the ASK interaction is answered', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        resolvedInteractionIds: ['interaction-1'],
        messages: [
          {
            id: 'ask-1',
            role: 'agent',
            content: 'Need a choice',
            step: AgentStep.ASK,
            interaction: {
              interaction_id: 'interaction-1',
              interaction_type: 'choice',
            } as Message['interaction'],
          },
          {
            id: 'reply-1',
            role: 'user',
            content: 'Yes',
            interactionResponseTo: 'interaction-1',
          },
        ],
      })
    );
    expect(lead.kind).toBe('running');
  });

  it('recognizes an adjacent legacy ASK reply without correlation metadata', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        durableRunStatus: 'running',
        messages: [
          {
            id: 'ask-1',
            role: 'agent',
            content: 'Need a choice',
            step: AgentStep.ASK,
            interaction: {
              interaction_id: 'interaction-1',
              interaction_type: 'choice',
            } as Message['interaction'],
          },
          { id: 'reply-1', role: 'user', content: 'Yes' },
        ],
      })
    );

    expect(lead.kind).toBe('running');
  });

  it('does not use adjacency when the reply targets another interaction', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        messages: [
          {
            id: 'ask-1',
            role: 'agent',
            content: 'Need a choice',
            step: AgentStep.ASK,
            interaction: {
              interaction_id: 'interaction-1',
              interaction_type: 'choice',
            } as Message['interaction'],
          },
          {
            id: 'reply-1',
            role: 'user',
            content: 'Yes',
            interactionResponseTo: 'interaction-2',
          },
        ],
      })
    );

    expect(lead.kind).toBe('hitl');
  });

  it('does not treat a later non-adjacent user message as an ASK reply', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        messages: [
          {
            id: 'ask-1',
            role: 'agent',
            content: 'Need a choice',
            step: AgentStep.ASK,
            interaction: {
              interaction_id: 'interaction-1',
              interaction_type: 'choice',
            } as Message['interaction'],
          },
          { id: 'notice-1', role: 'agent', content: 'Still waiting' },
          { id: 'reply-1', role: 'user', content: 'Yes' },
        ],
      })
    );

    expect(lead.kind).toBe('hitl');
  });

  it('switches back to the spinner while a submitted answer reconciles', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.RUNNING,
        activeAsk: 'Agents.single_agent',
        durableRunStatus: 'running',
        isPending: true,
      })
    );

    expect(lead.kind).toBe('running');
    expect(lead.Icon).toBe(LoaderCircle);
    expect(lead.spin).toBe(true);
  });

  it('uses Alert with warning color while waiting to confirm a plan', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        sessionMode: SessionMode.WORKFORCE,
        status: ChatTaskStatus.PENDING,
        hasWaitComfirm: true,
      })
    );
    expect(lead.kind).toBe('hitl');
    expect(lead.Icon).toBe(AlertTriangle);
    expect(lead.iconClassName).toBe('!text-ds-icon-warning-default-default');
  });

  it('uses Alert with warning color when a workforce subtask is blocked', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        sessionMode: SessionMode.WORKFORCE,
        status: ChatTaskStatus.RUNNING,
        taskRunning: [
          { id: 'sub-1', content: 'Blocked', status: TaskStatus.BLOCKED },
        ],
      })
    );
    expect(lead.kind).toBe('blocked');
    expect(lead.Icon).toBe(AlertTriangle);
    expect(lead.iconClassName).toBe('!text-ds-icon-warning-default-default');
  });

  it('keeps the spinner when a workforce subtask is only waiting to start', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        sessionMode: SessionMode.WORKFORCE,
        status: ChatTaskStatus.RUNNING,
        taskRunning: [
          { id: 'sub-1', content: 'Queued', status: TaskStatus.WAITING },
        ],
      })
    );
    expect(lead.kind).toBe('running');
    expect(lead.Icon).toBe(LoaderCircle);
  });

  it('does not treat a finished task as still needing input', () => {
    const lead = getSessionNavLeadPresentation(
      task({
        status: ChatTaskStatus.FINISHED,
        activeAsk: 'Agents.single_agent',
      })
    );
    expect(lead.kind).toBe('finished');
  });
});
