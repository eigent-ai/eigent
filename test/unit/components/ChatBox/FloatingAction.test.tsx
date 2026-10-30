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

import { FloatingAction } from '@/components/ChatBox/MessageItem/FloatingAction';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const scrollButton = () =>
  screen.getByRole('button', { name: 'Scroll to bottom' });

describe('FloatingAction', () => {
  it('renders nothing while idle at the latest content', () => {
    const { container } = render(
      <FloatingAction
        showStop={false}
        running={false}
        scrolledUp={false}
        onScrollToBottom={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('splits Stop task and the running indicator while a task runs', () => {
    const onStop = vi.fn();
    const onScrollToBottom = vi.fn();
    render(
      <FloatingAction
        showStop
        onStop={onStop}
        running
        scrolledUp={false}
        onScrollToBottom={onScrollToBottom}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop Task' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-orientation="vertical"]')).not.toBe(
      null
    );
    // Dots show until hover or focus reveals the arrow on the same button.
    expect(scrollButton()).toHaveAttribute(
      'data-floating-scroll-state',
      'running'
    );
    expect(
      scrollButton().querySelectorAll('.bg-ds-accent-default-default')
    ).toHaveLength(3);
    fireEvent.click(scrollButton());
    expect(onScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('offers only the arrow when the timeline is scrolled up without a task', () => {
    const onScrollToBottom = vi.fn();
    render(
      <FloatingAction
        showStop={false}
        running={false}
        scrolledUp
        onScrollToBottom={onScrollToBottom}
      />
    );

    expect(screen.queryByRole('button', { name: 'Stop Task' })).toBeNull();
    expect(document.querySelector('[data-orientation="vertical"]')).toBe(null);
    expect(scrollButton()).toHaveAttribute(
      'data-floating-scroll-state',
      'arrow'
    );
    fireEvent.click(scrollButton());
    expect(onScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('keeps the running dots beside Stop task even when scrolled up', () => {
    render(
      <FloatingAction showStop running scrolledUp onScrollToBottom={vi.fn()} />
    );

    expect(
      screen.getByRole('button', { name: 'Stop Task' })
    ).toBeInTheDocument();
    expect(scrollButton()).toHaveAttribute(
      'data-floating-scroll-state',
      'running'
    );
  });

  it('disables Stop task while a stop request is in flight', () => {
    render(
      <FloatingAction
        showStop
        stopLoading
        running
        scrolledUp={false}
        onScrollToBottom={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Stop Task' })).toBeDisabled();
  });
});
