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
  detectInputType,
  extractChoices,
  normalizeMessagesToChatTurns,
} from '@/components/ChatBox/renderSession/normalizeMessages';
import { AgentStep } from '@/types/constants';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _id = 0;
function id() {
  return `msg-${++_id}`;
}

function userMsg(content: string, extra?: Partial<Message>): Message {
  return { id: id(), role: 'user', content, ...extra };
}

function agentMsg(
  content: string,
  step?: string,
  extra?: Partial<Message>
): Message {
  return {
    id: id(),
    role: 'agent',
    content,
    step: step as any,
    ...extra,
  };
}

function normalize(
  messages: Message[],
  opts?: { activeAsk?: string; taskRunning?: boolean }
) {
  return normalizeMessagesToChatTurns({
    messages,
    activeAsk: opts?.activeAsk ?? '',
    taskId: 'task-1',
    taskRunning: opts?.taskRunning ?? false,
  });
}

// ---------------------------------------------------------------------------
// detectInputType
// ---------------------------------------------------------------------------

describe('detectInputType', () => {
  it('returns choice_input for yes/no questions', () => {
    expect(detectInputType('Would you like to continue? yes or no')).toBe(
      'choice_input'
    );
  });

  it('returns choice_input for approve/reject questions', () => {
    expect(detectInputType('Please approve or reject the plan.')).toBe(
      'choice_input'
    );
  });

  it('returns context_input for "more context" questions', () => {
    expect(
      detectInputType('Could you provide more context about the project?')
    ).toBe('context_input');
  });

  it('returns text_input for open-ended questions', () => {
    expect(detectInputType('What is the target audience?')).toBe('text_input');
  });

  it('returns choice_input for numbered list options', () => {
    const q =
      'Which approach?\n1. Research competitors\n2. Start writing\n3. Gather feedback';
    expect(detectInputType(q)).toBe('choice_input');
  });

  it('returns choice_input for lettered list options', () => {
    const q =
      'Select a format:\nA. Detailed report\nB. Executive summary\nC. Slide deck';
    expect(detectInputType(q)).toBe('choice_input');
  });

  it('returns choice_input for numbered options with parenthesis separator', () => {
    const q = 'Choose one:\n1) Option Alpha\n2) Option Beta\n3) Option Gamma';
    expect(detectInputType(q)).toBe('choice_input');
  });
});

// ---------------------------------------------------------------------------
// extractChoices
// ---------------------------------------------------------------------------

describe('extractChoices', () => {
  it('returns Yes/No by default', () => {
    expect(extractChoices('Proceed? yes or no')).toEqual(['Yes', 'No']);
  });

  it('returns Approve/Reject', () => {
    expect(extractChoices('Do you approve or reject this?')).toEqual([
      'Approve',
      'Reject',
    ]);
  });

  it('returns Continue/Stop', () => {
    expect(extractChoices('Should I continue or stop?')).toEqual([
      'Continue',
      'Stop',
    ]);
  });

  it('extracts three numbered options', () => {
    const q =
      'Which approach?\n1. Research competitors\n2. Start writing\n3. Gather feedback';
    expect(extractChoices(q)).toEqual([
      'Research competitors',
      'Start writing',
      'Gather feedback',
    ]);
  });

  it('extracts lettered options (A/B/C)', () => {
    const q =
      'Select a format:\nA. Detailed report\nB. Executive summary\nC. Slide deck';
    expect(extractChoices(q)).toEqual([
      'Detailed report',
      'Executive summary',
      'Slide deck',
    ]);
  });

  it('extracts two numbered options with parenthesis', () => {
    const q = 'Choose:\n1) Option One\n2) Option Two';
    expect(extractChoices(q)).toEqual(['Option One', 'Option Two']);
  });
});

// ---------------------------------------------------------------------------
// normalizeMessagesToChatTurns
// ---------------------------------------------------------------------------

describe('normalizeMessagesToChatTurns — simple user/agent turn', () => {
  it('creates one turn with a markdown block', () => {
    const msgs = [userMsg('hello'), agentMsg('world', AgentStep.WAIT_CONFIRM)];
    const turns = normalize(msgs);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.userBlock?.content).toBe('hello');
    expect(turns[0]!.agentBlocks).toHaveLength(1);
    expect(turns[0]!.agentBlocks[0]!.type).toBe('markdown');
  });
});

describe('normalizeMessagesToChatTurns — ASK followed by user reply', () => {
  it('marks the question block as inactive once a user reply follows', () => {
    const ask = agentMsg('Yes or no?', AgentStep.ASK, {
      agent_name: 'browser_agent',
    });
    const reply = userMsg('Yes');
    const msgs = [userMsg('do it'), ask, reply];
    const turns = normalize(msgs, { activeAsk: '' });

    // Two turns: original prompt, then the reply
    expect(turns).toHaveLength(2);
    const questionBlock = turns[0]!.agentBlocks.find(
      (b) => b.type === 'question'
    );
    expect(questionBlock).toBeDefined();
    expect(questionBlock?.type === 'question' && questionBlock.isActive).toBe(
      false
    );
  });
});

describe('normalizeMessagesToChatTurns — ASK with no reply yet (active)', () => {
  it('marks the question block as active when activeAsk is set and no user follows', () => {
    const ask = agentMsg('Continue or stop?', AgentStep.ASK, {
      agent_name: 'browser_agent',
    });
    const msgs = [userMsg('do it'), ask];
    const turns = normalize(msgs, { activeAsk: 'browser_agent' });

    expect(turns).toHaveLength(1);
    const questionBlock = turns[0]!.agentBlocks.find(
      (b) => b.type === 'question'
    );
    expect(questionBlock?.type === 'question' && questionBlock.isActive).toBe(
      true
    );
    expect(questionBlock?.type === 'question' && questionBlock.inputType).toBe(
      'choice_input'
    );
  });
});

describe('normalizeMessagesToChatTurns — final answer with files', () => {
  it('creates a completion block with fileList', () => {
    const endMsg = agentMsg('Done!', AgentStep.END);
    (endMsg as any).fileList = [
      { name: 'report.pdf', type: 'pdf', path: '/out/report.pdf' },
    ];
    const msgs = [userMsg('run'), endMsg];
    const turns = normalize(msgs);

    expect(turns).toHaveLength(1);
    const completion = turns[0]!.agentBlocks.find(
      (b) => b.type === 'completion'
    );
    expect(completion).toBeDefined();
    expect(
      completion?.type === 'completion' && completion.fileList
    ).toHaveLength(1);
  });
});

describe('normalizeMessagesToChatTurns — orphan agent message', () => {
  it('wraps an initial agent message in an orphan turn', () => {
    const msgs = [agentMsg('hello', AgentStep.WAIT_CONFIRM)];
    const turns = normalize(msgs);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.userBlock).toBeNull();
    expect(turns[0]!.agentBlocks).toHaveLength(1);
  });
});

describe('normalizeMessagesToChatTurns — multi-turn conversation', () => {
  it('groups messages into separate turns per user message', () => {
    const msgs = [
      userMsg('first'),
      agentMsg('answer 1'),
      userMsg('second'),
      agentMsg('answer 2'),
    ];
    const turns = normalize(msgs);
    expect(turns).toHaveLength(2);
    expect(turns[0]!.userBlock?.content).toBe('first');
    expect(turns[1]!.userBlock?.content).toBe('second');
  });
});
