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
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => ({
  getAuthStore: vi.fn(() => ({ language: 'en-US' })),
  useAuthStore: vi.fn(() => ({ appearance: 'light' })),
}));

describe('HeaderBox chat timeline mode', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
    usePageTabStore.setState({ chatTimelineDetailLevel: 'narrative' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('places the mode toggle between token usage and preview controls', () => {
    render(<HeaderBox totalTokens={42} workSessionName="Timeline session" />);

    const tokenLabel = screen.getByText(/Total:/);
    const toggle = screen.getByRole('radiogroup', {
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

    const options = screen.getAllByRole('radio');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'Narrative',
      'Trajectory',
    ]);
    expect(screen.getByRole('radio', { name: 'Narrative' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('switches the event timeline presentation from the toggle', async () => {
    const user = userEvent.setup();
    render(<HeaderBox totalTokens={42} />);

    await user.click(screen.getByRole('radio', { name: 'Trajectory' }));

    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe(
      'trajectory'
    );
    expect(screen.getByRole('radio', { name: 'Trajectory' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByRole('radio', { name: 'Narrative' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
  });
});
