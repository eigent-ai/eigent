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

import { InterruptedRunBanner } from '@/components/ChatBox/InterruptedRunBanner';

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
