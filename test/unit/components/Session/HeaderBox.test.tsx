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

describe('HeaderBox chat timeline style', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
    usePageTabStore.setState({ chatTimelineDetailLevel: 'normal' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('places the captions menu between token usage and preview controls', () => {
    render(<HeaderBox totalTokens={42} projectName="Timeline project" />);

    const tokenLabel = screen.getByText(/Total:/);
    const timelineButton = screen.getByRole('button', {
      name: 'Chat timeline style: Normal',
    });
    const previewButton = screen.getByRole('button', {
      name: 'Open preview',
    });

    expect(
      tokenLabel.compareDocumentPosition(timelineButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      timelineButton.compareDocumentPosition(previewButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('updates the event timeline presentation from the dropdown', async () => {
    const user = userEvent.setup();
    render(<HeaderBox totalTokens={42} />);

    await user.click(
      screen.getByRole('button', {
        name: 'Chat timeline style: Normal',
      })
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Detailed' }));

    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe('detailed');
    expect(
      screen.getByRole('button', {
        name: 'Chat timeline style: Detailed',
      })
    ).toBeInTheDocument();
  });
});
