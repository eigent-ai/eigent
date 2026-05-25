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

import { BoxHeaderAsk } from '@/components/ChatBox/BottomBox/BoxHeaderAsk';
import type { AskPayload } from '@/components/ChatBox/renderSession/types';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePayload(overrides?: Partial<AskPayload>): AskPayload {
  return {
    prompt: 'What is the target audience?',
    agentName: 'browser_agent',
    inputs: [{ kind: 'text', id: 'text' }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BoxHeaderAsk — display', () => {
  it('renders the question text and agent label', () => {
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={vi.fn()} />);
    expect(
      screen.getByText('What is the target audience?')
    ).toBeInTheDocument();
    expect(screen.getByText(/browser_agent asks/i)).toBeInTheDocument();
  });

  it('shows the countdown timer', () => {
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={vi.fn()} />);
    expect(screen.getByText(/s auto-skip/i)).toBeInTheDocument();
  });
});

describe('BoxHeaderAsk — text submit', () => {
  it('calls onSubmit with typed text on send button click', async () => {
    const onSubmit = vi.fn();
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={onSubmit} />);

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Young adults');

    const sendBtn = screen.getByRole('button', { name: /send/i });
    await userEvent.click(sendBtn);

    expect(onSubmit).toHaveBeenCalledWith('Young adults');
  });

  it('calls onSubmit with typed text on Enter key', async () => {
    const onSubmit = vi.fn();
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={onSubmit} />);

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'My answer{Enter}');

    expect(onSubmit).toHaveBeenCalledWith('My answer');
  });

  it('does not submit on empty text', async () => {
    const onSubmit = vi.fn();
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={onSubmit} />);

    // Only the Send button exists (text input, single block)
    const sendBtn = screen.getByRole('button', { name: /send/i });
    await userEvent.click(sendBtn);

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('BoxHeaderAsk — choice_input', () => {
  it('renders choice buttons and calls onSubmit on click', async () => {
    const onSubmit = vi.fn();
    render(
      <BoxHeaderAsk
        askPayload={makePayload({
          prompt: 'Should I continue?',
          inputs: [
            {
              kind: 'choice',
              id: 'choice',
              options: [
                { value: 'Yes', label: 'Yes' },
                { value: 'No', label: 'No' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />
    );

    const yesBtn = screen.getByRole('button', { name: 'Yes' });
    await userEvent.click(yesBtn);

    expect(onSubmit).toHaveBeenCalledWith('Yes');
  });

  it('does not call onSubmit twice on double-click', async () => {
    const onSubmit = vi.fn();
    render(
      <BoxHeaderAsk
        askPayload={makePayload({
          inputs: [
            {
              kind: 'choice',
              id: 'choice',
              options: [
                { value: 'Yes', label: 'Yes' },
                { value: 'No', label: 'No' },
              ],
            },
          ],
        })}
        onSubmit={onSubmit}
      />
    );

    const yesBtn = screen.getByRole('button', { name: 'Yes' });
    await userEvent.dblClick(yesBtn);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('BoxHeaderAsk — auto-skip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onSubmit with "skip" after 30 seconds', async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn();
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={onSubmit} />);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(onSubmit).toHaveBeenCalledWith('skip');
  });

  it('counts down from 30 to 0', async () => {
    vi.useFakeTimers();
    render(<BoxHeaderAsk askPayload={makePayload()} onSubmit={vi.fn()} />);

    expect(screen.getByText(/30s auto-skip/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByText(/25s auto-skip/i)).toBeInTheDocument();
  });
});
