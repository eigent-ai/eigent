import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QueuedBox } from './QueuedBox';

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
