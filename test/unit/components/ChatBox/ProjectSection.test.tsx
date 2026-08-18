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

import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

import { groupMessagesByQuery } from '@/components/ChatBox/ProjectSection';
import { isUserMessageReplyToAsk } from '@/components/ChatBox/UserQueryGroup';

const userMessage = (id: string, content: string) => ({
  id,
  role: 'user',
  content,
});

const structuredAsk = (id: string, question: string) => ({
  id,
  role: 'agent',
  step: AgentStep.ASK,
  content: question,
  interaction: {
    interaction_id: `interaction-${id}`,
    interaction_type: 'question',
    run_id: 'run-1',
    question,
  },
});

describe('legacy Run query grouping', () => {
  it('keeps a structured ASK reply in the same group and preserves one work-log owner', () => {
    const prompt = userMessage('user-prompt', 'Research this topic');
    const ask = structuredAsk('ask-1', 'Which market should I use?');
    const response = userMessage('reply-1', 'The UK market');

    const beforeReply = groupMessagesByQuery([prompt, ask]);
    const afterReply = groupMessagesByQuery([prompt, ask, response]);

    expect(beforeReply).toHaveLength(1);
    expect(afterReply).toHaveLength(1);
    expect(afterReply[0].userMessage).toBe(prompt);
    expect(afterReply[0].interactionResponses?.[ask.id]).toBe(response);
    expect(afterReply.filter((group) => group.ownsRunWorkLog)).toHaveLength(1);
    expect(afterReply[0].ownsRunWorkLog).toBe(true);
  });

  it('keeps an ordinary follow-up as a new turn without moving the previous Run log', () => {
    const firstPrompt = userMessage('user-1', 'Create a report');
    const firstResponse = {
      id: 'agent-1',
      role: 'agent',
      step: AgentStep.END,
      content: 'Report created',
    };
    const followUp = userMessage('user-2', 'Now add a chart');

    const groups = groupMessagesByQuery([firstPrompt, firstResponse, followUp]);

    expect(groups).toHaveLength(2);
    expect(groups[0].ownsRunWorkLog).toBe(true);
    expect(groups[1].ownsRunWorkLog).not.toBe(true);
    expect(groups[1].userMessage).toBe(followUp);
  });

  it('classifies only the user message directly following ASK as a human reply', () => {
    const firstPrompt = userMessage('user-1', 'Initial query');
    const ask = structuredAsk('ask-1', 'Choose a region');
    const reply = userMessage('user-2', 'Europe');

    const messages = [firstPrompt, ask, reply];

    expect(isUserMessageReplyToAsk(messages, firstPrompt.id)).toBe(false);
    expect(isUserMessageReplyToAsk(messages, reply.id)).toBe(true);
  });

  it('folds a strictly-adjacent legacy ASK reply into the same Run', () => {
    const prompt = userMessage('user-1', 'Initial query');
    const legacyAsk = {
      id: 'ask-legacy',
      role: 'agent',
      step: AgentStep.ASK,
      content: 'Tell me more',
    };
    const reply = userMessage('user-2', 'More detail');

    const groups = groupMessagesByQuery([prompt, legacyAsk, reply]);

    expect(groups).toHaveLength(1);
    expect(groups[0].interactionResponses?.[legacyAsk.id]).toBe(reply);
    expect(groups.filter((group) => group.ownsRunWorkLog)).toHaveLength(1);
  });

  it('does not fold a non-adjacent user turn into a legacy ASK receipt', () => {
    const prompt = userMessage('user-1', 'Initial query');
    const legacyAsk = {
      id: 'ask-legacy',
      role: 'agent',
      step: AgentStep.ASK,
      content: 'Tell me more',
    };
    const interveningAgentMessage = {
      id: 'agent-2',
      role: 'agent',
      content: 'Continuing without input',
    };
    const followUp = userMessage('user-2', 'A normal follow-up');

    const groups = groupMessagesByQuery([
      prompt,
      legacyAsk,
      interveningAgentMessage,
      followUp,
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].interactionResponses).toBeUndefined();
    expect(groups[1].userMessage).toBe(followUp);
  });

  it('does not fold a response carrying a different interaction identity', () => {
    const prompt = userMessage('user-1', 'Initial query');
    const ask = structuredAsk('ask-1', 'Choose a region');
    const mismatchedReply = {
      ...userMessage('user-2', 'Europe'),
      interactionResponseTo: 'interaction-some-other-ask',
    };

    const groups = groupMessagesByQuery([prompt, ask, mismatchedReply]);

    expect(groups).toHaveLength(2);
    expect(groups[0].interactionResponses).toBeUndefined();
    expect(groups[1].userMessage).toBe(mismatchedReply);
    expect(
      isUserMessageReplyToAsk([prompt, ask, mismatchedReply], 'user-2')
    ).toBe(false);
  });
});
