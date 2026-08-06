import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InterruptedRunBanner } from './InterruptedRunBanner';

const props = {
  title: 'Run interrupted',
  description: 'Completed work is saved.',
  resumeLabel: 'Resume',
  resumingLabel: 'Resuming…',
  cancelLabel: 'Cancel Run',
  cancellingLabel: 'Cancelling…',
  onResume: vi.fn(),
  onCancel: vi.fn(),
};

describe('InterruptedRunBanner', () => {
  it('offers explicit Resume and Cancel actions', () => {
    const onResume = vi.fn();
    const onCancel = vi.fn();
    render(
      <InterruptedRunBanner
        {...props}
        action={null}
        onResume={onResume}
        onCancel={onCancel}
        attemptNumber={1}
      />
    );

    expect(screen.getByText('Run interrupted')).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Run' }));
    expect(onResume).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('locks both actions while Resume admission is in flight', () => {
    render(<InterruptedRunBanner {...props} action="resuming" />);

    expect(screen.getByRole('button', { name: 'Resuming…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel Run' })).toBeDisabled();
  });

  it('renders cloud-restored history without execution actions', () => {
    render(
      <InterruptedRunBanner
        {...props}
        action={null}
        readOnly
        title="History restored from cloud"
      />
    );

    expect(screen.getByText('History restored from cloud')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel Run' })).toBeNull();
  });
});
