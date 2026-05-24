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

import { QuestionBlock } from '@/components/ChatBox/messages/askBlocks/QuestionBlock';
import type { QuestionChatBlock } from '@/components/ChatBox/renderSession/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

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

describe('QuestionBlock — view-only display', () => {
  it('renders the question text', () => {
    render(<QuestionBlock block={makeBlock()} />);
    expect(
      screen.getByText('What is the target audience?')
    ).toBeInTheDocument();
  });

  it('renders the agent label', () => {
    render(<QuestionBlock block={makeBlock()} />);
    expect(screen.getByText(/browser_agent asks/i)).toBeInTheDocument();
  });

  it('shows "Reply below" hint when active', () => {
    render(<QuestionBlock block={makeBlock({ isActive: true })} />);
    expect(screen.getByText(/reply below/i)).toBeInTheDocument();
  });

  it('shows "Answered" label when inactive', () => {
    render(<QuestionBlock block={makeBlock({ isActive: false })} />);
    expect(screen.getByText('Answered')).toBeInTheDocument();
  });

  it('renders no input controls', () => {
    render(<QuestionBlock block={makeBlock()} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
