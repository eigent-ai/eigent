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

// jsdom reports no Electron platform, so labels resolve to the Enter wording.
describe('BottomBox approval shortcuts', () => {
  it('maps Enter to approve once and Shift+Enter to the run scope', () => {
    const onApprove = vi.fn();
    render(
      <ControlInputRouter
        variant={approvalVariant(onApprove)}
        inputProps={{}}
      />
    );

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });

    expect(onApprove).toHaveBeenNthCalledWith(1, 'once');
    expect(onApprove).toHaveBeenNthCalledWith(2, 'run');

    const approveOnce = screen.getByRole('button', { name: 'Approve once' });
    const allowForRun = screen.getByRole('button', {
      name: 'Allow for this run',
    });
    const approveOnceShortcut = within(approveOnce).getByText('Enter');
    const allowForRunShortcut = within(allowForRun).getByText('Shift+Enter');
    expect(approveOnceShortcut.tagName).toBe('KBD');
    expect(approveOnceShortcut).toHaveClass(
      'bg-primary-2',
      'rounded-full',
      'opacity-60',
      'text-[9px]',
      'text-primary-11',
      'ring-[var(--colors-black-10)]'
    );
    expect(allowForRunShortcut).toHaveClass(
      'bg-primary-2',
      'rounded-full',
      'opacity-60',
      'text-[9px]',
      'text-primary-11',
      'ring-[var(--colors-black-10)]'
    );
    expect(approveOnceShortcut).not.toHaveClass(
      'bg-transparent',
      'text-ds-text-success-inverse-default'
    );

    // The standing space-wide grant must never be reachable from the keyboard.
    const alwaysAllow = screen.getByRole('button', { name: 'Always allow' });
    expect(within(alwaysAllow).queryByRole('note')).toBeNull();
    expect(alwaysAllow.querySelector('kbd')).toBeNull();
    expect(onApprove).not.toHaveBeenCalledWith('space');
  });

  it('ignores Enter while focus sits outside the approval surface', () => {
    const onApprove = vi.fn();
    render(
      <ControlInputRouter
        variant={approvalVariant(onApprove)}
        inputProps={{}}
      />
    );

    // Stand in for an open dialog or popover holding focus elsewhere.
    const elsewhere = document.createElement('div');
    elsewhere.tabIndex = -1;
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Enter', shiftKey: true });

    expect(onApprove).not.toHaveBeenCalled();
    elsewhere.remove();
  });

  it('does not approve from an interactive element or on key repeat', () => {
    const onApprove = vi.fn();
    render(
      <ControlInputRouter
        variant={approvalVariant(onApprove)}
        inputProps={{}}
      />
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Approve once' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });

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
      'bg-primary-2',
      'rounded-full',
      'opacity-60',
      'text-[9px]',
      'text-primary-11',
      'ring-[var(--colors-black-10)]'
    );

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Feedback' }), {
      key: 'Enter',
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});
