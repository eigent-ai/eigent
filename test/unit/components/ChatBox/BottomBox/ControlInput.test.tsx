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

import { ControlInputRouter } from '@/components/ChatBox/BottomBox/ControlInput';
import type { BottomBoxApprovalVariant } from '@/components/ChatBox/BottomBox/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

function approvalVariant(
  onApprove: BottomBoxApprovalVariant['onApprove']
): BottomBoxApprovalVariant {
  return {
    kind: 'approval',
    header: { title: 'Allow this action?' },
    options: [
      { scope: 'once', label: 'Approve once' },
      { scope: 'run', label: 'Allow for this run' },
      { scope: 'space', label: 'Always allow' },
    ],
    onApprove,
    onReject: vi.fn(),
  };
}

describe('BottomBox approval keyboard safety', () => {
  it('does not approve from window or body Enter', () => {
    const onApprove = vi.fn();
    render(
      <ControlInputRouter
        variant={approvalVariant(onApprove)}
        inputProps={{}}
      />
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });
    document.body.focus();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Enter', shiftKey: true });

    expect(onApprove).not.toHaveBeenCalled();
  });

  it('uses native keyboard activation only on the focused scope button', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(
      <ControlInputRouter
        variant={approvalVariant(onApprove)}
        inputProps={{}}
      />
    );

    const approveOnce = screen.getByRole('button', { name: 'Approve once' });
    const allowForRun = screen.getByRole('button', {
      name: 'Allow for this run',
    });
    approveOnce.focus();
    await user.keyboard('{Enter}');
    allowForRun.focus();
    await user.keyboard('{Enter}');

    expect(onApprove).toHaveBeenNthCalledWith(1, 'once');
    expect(onApprove).toHaveBeenNthCalledWith(2, 'run');
  });

  it('does not advertise removed approval shortcuts', () => {
    const onApprove = vi.fn();
    render(
      <ControlInputRouter
        variant={approvalVariant(onApprove)}
        inputProps={{}}
      />
    );

    expect(screen.queryByText('Enter')).toBeNull();
    expect(screen.queryByText('Shift+Enter')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Approve once' }).querySelector('kbd')
    ).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Allow for this run' })
        .querySelector('kbd')
    ).toBeNull();
    const alwaysAllow = screen.getByRole('button', { name: 'Always allow' });
    expect(alwaysAllow.querySelector('kbd')).toBeNull();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('puts the Enter keycap inside Send feedback and keeps Enter active', () => {
    const onSubmit = vi.fn();
    render(
      <ControlInputRouter
        variant={{
          kind: 'feedback',
          header: { title: 'What should change?' },
          value: 'Use the compact layout',
          onChange: vi.fn(),
          onSubmit,
        }}
        inputProps={{}}
      />
    );

    const sendFeedback = screen.getByRole('button', {
      name: 'Send feedback',
    });
    expect(within(sendFeedback).getByText('Enter')).toHaveClass(
      'bg-ds-accent-subtle-default',
      'rounded-full',
      'opacity-60',
      '!text-ds-text-meta',
      'text-ds-accent-default-default',
      'ring-ds-hairline-muted-default'
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Feedback' }), {
      key: 'Enter',
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
