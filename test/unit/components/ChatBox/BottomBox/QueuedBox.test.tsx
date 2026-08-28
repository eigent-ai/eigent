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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QueuedBox } from '@/components/ChatBox/BottomBox/QueuedBox';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue || key,
  }),
}));

describe('QueuedBox', () => {
  it('keeps pending messages above the composer and offers Send now', () => {
    const onSendNow = vi.fn();
    const onRemove = vi.fn();
    render(
      <QueuedBox
        queuedMessages={[{ id: 'follow-1', content: 'Use the new attachment' }]}
        onSendQueuedMessageNow={onSendNow}
        onRemoveQueuedMessage={onRemove}
      />
    );

    expect(screen.getByText('Use the new attachment')).toBeInTheDocument();
    const hiddenSendNow = screen.getByRole('button', { name: 'Send now' });
    expect(hiddenSendNow).toBeDisabled();
    expect(hiddenSendNow).toHaveAttribute('tabindex', '-1');
    fireEvent.mouseEnter(
      screen.getByText('Use the new attachment').closest('div.relative')!
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(onSendNow).toHaveBeenCalledWith('follow-1');
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('does not offer follow-up controls for trigger jobs', () => {
    render(
      <QueuedBox
        queuedMessages={[
          {
            id: 'trigger-1',
            content: 'Scheduled report',
            canSendNow: false,
          },
        ]}
      />
    );

    expect(screen.queryByRole('button', { name: 'Send now' })).toBeNull();
  });

  it('locks controls while a queued Run is being admitted', () => {
    render(
      <QueuedBox
        queuedMessages={[
          {
            id: 'follow-1',
            content: 'Continue',
            processing: true,
          },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'Send now' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'chat.remove-queued-message' })
    ).toBeDisabled();
  });
});
