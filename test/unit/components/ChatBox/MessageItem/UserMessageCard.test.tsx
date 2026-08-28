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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock, toastErrorMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/host', () => ({
  useHost: () => ({ ipcRenderer: { invoke: invokeMock } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';

describe('UserMessageCard', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ success: true });
    toastErrorMock.mockReset();
  });

  it('renders as a right-aligned chat bubble with a tighter tail corner', () => {
    const { container } = render(
      <UserMessageCard id="user-message-1" content="Hello from the user" />
    );

    const root = container.firstElementChild;
    const bubble = root?.firstElementChild;

    expect(root).toHaveClass('pl-16');
    expect(bubble).toHaveClass('rounded-xl', 'rounded-br-sm');
  });

  it('keeps rendered skill and connector tags on the body-text baseline', () => {
    const { container } = render(
      <UserMessageCard
        id="user-message-tags"
        content="Use #browser with @github"
      />
    );

    for (const token of ['#browser', '@github']) {
      const tag = [...container.querySelectorAll('span')].find(
        (element) => element.textContent === token
      );

      expect(tag).toHaveClass(
        'align-baseline',
        '!text-ds-text-base',
        '!font-normal'
      );
    }
  });

  it('keeps durable attachment names display-only', () => {
    render(
      <UserMessageCard
        id="display-only-attachment"
        content="Restored message"
        attaches={[{ fileName: 'report.pdf' }]}
      />
    );

    const attachment = screen.getByTitle('report.pdf').closest('div');
    expect(attachment).toHaveAttribute(
      'data-attachment-capability',
      'display-only'
    );
    fireEvent.click(attachment!);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reveals only a trusted legacy local attachment path', () => {
    render(
      <UserMessageCard
        id="local-attachment"
        content="Local message"
        attaches={[
          { fileName: 'report.pdf', filePath: '/workspace/report.pdf' },
        ]}
      />
    );

    const attachment = screen.getByTitle('report.pdf').closest('div');
    expect(attachment).toHaveAttribute('data-attachment-capability', 'reveal');
    fireEvent.click(attachment!);
    expect(invokeMock).toHaveBeenCalledWith(
      'reveal-in-folder',
      '/workspace/report.pdf'
    );
  });

  it('shows feedback when a restored attachment has lost its session grant', async () => {
    invokeMock.mockResolvedValue({
      success: false,
      error: 'Path is outside the active workspace',
    });
    render(
      <UserMessageCard
        id="restored-local-attachment"
        content="Restored message"
        attaches={[
          { fileName: 'report.pdf', filePath: '/downloads/report.pdf' },
        ]}
      />
    );

    fireEvent.click(screen.getByTitle('report.pdf').closest('div')!);

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Path is outside the active workspace'
      )
    );
  });
});
