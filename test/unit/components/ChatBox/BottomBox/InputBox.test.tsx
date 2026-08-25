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

import { Inputbox } from '@/components/ChatBox/BottomBox/InputBox';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ChatBox/BottomBox/RichChatInput', async () => {
  const { forwardRef } = await import('react');
  return {
    RichChatInput: forwardRef<
      HTMLDivElement,
      {
        value?: string;
        onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
      }
    >(({ value, onKeyDown }, ref) => (
      <div ref={ref} data-testid="rich-chat-input" onKeyDown={onKeyDown}>
        {value}
      </div>
    )),
  };
});

function primaryAction(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(
    '[data-composer-primary-action]'
  )!;
}

describe('Inputbox primary action', () => {
  it('rotates the default arrow upward when text becomes sendable', () => {
    const onSend = vi.fn();
    const { container, rerender } = render(
      <Inputbox value="" onSend={onSend} />
    );

    expect(primaryAction(container)).toHaveAttribute(
      'data-composer-primary-action',
      'idle'
    );
    expect(primaryAction(container)).toBeDisabled();
    expect(
      container.querySelector('[data-composer-primary-icon="arrow"]')
    ).toHaveClass('rotate-0', 'motion-reduce:transition-none');

    rerender(<Inputbox value="Queue this next" onSend={onSend} />);

    expect(primaryAction(container)).toHaveAttribute(
      'data-composer-primary-action',
      'send'
    );
    expect(primaryAction(container)).not.toBeDisabled();
    expect(
      container.querySelector('[data-composer-primary-icon="arrow"]')
    ).toHaveClass('-rotate-90');
    fireEvent.click(primaryAction(container));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('uses pause and resume while an empty composer controls a live task', () => {
    const onPauseTask = vi.fn();
    const onResumeTask = vi.fn();
    const { container, rerender } = render(
      <Inputbox
        taskControlState="running"
        onPauseTask={onPauseTask}
        onResumeTask={onResumeTask}
      />
    );

    expect(primaryAction(container)).toHaveAttribute(
      'data-composer-primary-action',
      'pause'
    );
    fireEvent.click(primaryAction(container));
    expect(onPauseTask).toHaveBeenCalledOnce();

    rerender(
      <Inputbox
        taskControlState="paused"
        onPauseTask={onPauseTask}
        onResumeTask={onResumeTask}
      />
    );

    expect(primaryAction(container)).toHaveAttribute(
      'data-composer-primary-action',
      'resume'
    );
    expect(primaryAction(container)).toHaveAttribute('aria-label', 'Continue');
    fireEvent.click(primaryAction(container));
    expect(onResumeTask).toHaveBeenCalledOnce();
  });

  it('prioritizes sending text or files over pause and resume', () => {
    const onSend = vi.fn();
    const onPauseTask = vi.fn();
    const { container, rerender } = render(
      <Inputbox
        value="A follow-up"
        taskControlState="running"
        onPauseTask={onPauseTask}
        onSend={onSend}
      />
    );

    expect(primaryAction(container)).toHaveAttribute(
      'data-composer-primary-action',
      'send'
    );
    fireEvent.click(primaryAction(container));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onPauseTask).not.toHaveBeenCalled();

    rerender(
      <Inputbox
        files={[{ fileName: 'brief.pdf', filePath: '/tmp/brief.pdf' }]}
        taskControlState="running"
        onPauseTask={onPauseTask}
        onSend={onSend}
      />
    );

    expect(primaryAction(container)).toHaveAttribute(
      'data-composer-primary-action',
      'send'
    );
    fireEvent.click(primaryAction(container));
    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onPauseTask).not.toHaveBeenCalled();
  });

  it('sends a running-task follow-up with Return but not Shift+Return', () => {
    const onSend = vi.fn();
    const { getByTestId } = render(
      <Inputbox
        value="A follow-up"
        taskControlState="running"
        onSend={onSend}
      />
    );

    fireEvent.keyDown(getByTestId('rich-chat-input'), {
      key: 'Enter',
      shiftKey: true,
    });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.keyDown(getByTestId('rich-chat-input'), { key: 'Enter' });
    expect(onSend).toHaveBeenCalledOnce();
  });
});
