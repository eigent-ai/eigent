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

import { HeaderBox } from '@/components/Session/HeaderBox';
import { usePageTabStore } from '@/store/pageTabStore';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => ({
  getAuthStore: vi.fn(() => ({ language: 'en-US' })),
  useAuthStore: vi.fn(() => ({ appearance: 'light' })),
}));

describe('HeaderBox chat timeline mode', () => {
  let resizeHeader: ((width: number) => void) | undefined;

  beforeEach(() => {
    vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
    } as DOMRect);
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeHeader = (width) =>
            callback(
              [{ contentRect: { width } } as ResizeObserverEntry],
              this as unknown as ResizeObserver
            );
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    usePageTabStore.setState({ chatTimelineDetailLevel: 'narrative' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('places the mode toggle between token usage and preview controls', () => {
    render(<HeaderBox totalTokens={42} projectName="Timeline project" />);

    const tokenLabel = screen.getByText(/Total:/);
    const toggle = screen.getByRole('tablist', {
      name: 'Chat timeline style',
    });
    const previewButton = screen.getByRole('button', {
      name: 'Open preview',
    });

    expect(
      tokenLabel.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      toggle.compareDocumentPosition(previewButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('offers exactly the two timeline modes as a segmented control', () => {
    render(<HeaderBox totalTokens={42} />);

    const options = screen.getAllByRole('tab');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'Narrative',
      'Trajectory',
    ]);
    expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('hides token usage when the Session pane shrinks and keeps both right-side controls', () => {
    render(<HeaderBox totalTokens={42} />);

    expect(screen.getByText(/Total:/)).toBeInTheDocument();

    act(() => resizeHeader?.(400));

    expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('tablist', { name: 'Chat timeline style' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open preview' })
    ).toBeInTheDocument();
  });

  it('switches the event timeline presentation from the toggle', async () => {
    const user = userEvent.setup();
    render(<HeaderBox totalTokens={42} />);

    await user.click(screen.getByRole('tab', { name: 'Trajectory' }));

    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe(
      'trajectory'
    );
    expect(screen.getByRole('tab', { name: 'Trajectory' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });
});
