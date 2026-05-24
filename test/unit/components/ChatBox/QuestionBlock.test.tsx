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

import { QuestionBlock } from '@/components/ChatBox/MessageItem/blocks/QuestionBlock';
import { RenderSessionContext } from '@/components/ChatBox/renderSession/RenderSessionProvider';
import type { QuestionChatBlock } from '@/components/ChatBox/renderSession/types';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mockSubmitReply = vi.fn().mockResolvedValue(undefined);

function renderWithContext(block: QuestionChatBlock) {
  const ctx = {
    chatTurns: [],
    projectId: 'proj-1',
    taskId: 'task-1',
    activeAsk: block.isActive ? block.agentName : '',
    submitReply: mockSubmitReply,
  };

  return render(
    <RenderSessionContext.Provider value={ctx}>
      <QuestionBlock block={block} />
    </RenderSessionContext.Provider>
  );
}

function makeBlock(overrides?: Partial<QuestionChatBlock>): QuestionChatBlock {
  return {
    type: 'question',
    id: 'q-1',
    content: 'What is the target audience?',
    agentName: 'browser_agent',
    inputType: 'text_input',
    isActive: true,
    taskId: 'task-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuestionBlock — text submit', () => {
  it('calls submitReply with the typed text', async () => {
    renderWithContext(makeBlock());

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Young adults');

    const sendBtn = screen.getByRole('button');
    await userEvent.click(sendBtn);

    expect(mockSubmitReply).toHaveBeenCalledWith(
      'Young adults',
      'browser_agent'
    );
  });
});

describe('QuestionBlock — choice_input', () => {
  it('renders choice buttons and calls submitReply on click', async () => {
    renderWithContext(
      makeBlock({
        inputType: 'choice_input',
        choices: ['Yes', 'No'],
        content: 'Should I continue? Yes or No',
      })
    );

    const yesBtn = screen.getByRole('button', { name: 'Yes' });
    await userEvent.click(yesBtn);

    expect(mockSubmitReply).toHaveBeenCalledWith('Yes', 'browser_agent');
  });
});

describe('QuestionBlock — disabled when inactive', () => {
  it('disables the input and shows Answered label when not active', () => {
    renderWithContext(makeBlock({ isActive: false }));
    const textarea = screen.queryByRole('textbox');
    if (textarea) {
      expect(textarea).toBeDisabled();
    }
    expect(screen.getByText('Answered')).toBeInTheDocument();
  });
});

describe('QuestionBlock — skipped state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the skipped label after auto-skip fires', async () => {
    vi.useFakeTimers();
    renderWithContext(makeBlock());

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText(/skipped — task continues/i)).toBeInTheDocument();
  });
});
