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

import { HumanDecisionCard } from '@/components/ChatBox/BottomBox/HumanDecisionCard';
import type { BottomBoxApprovalVariant } from '@/components/ChatBox/BottomBox/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

function approval(
  onApprove: BottomBoxApprovalVariant['onApprove']
): BottomBoxApprovalVariant {
  return {
    kind: 'approval',
    header: { title: 'Allow this action?' },
    options: [{ scope: 'once', label: 'Approve once' }],
    onApprove,
    onReject: vi.fn(),
  };
}

describe('HumanDecisionCard', () => {
  it('shows only the approval type and title above its controls', () => {
    render(
      <HumanDecisionCard
        requestKey="run:approval-1"
        variant={{
          ...approval(vi.fn()),
          header: {
            eyebrow: 'Input required',
            title: 'Run shell_exec?',
            description: 'Technical context',
            contextItems: [{ id: 'agent', label: 'single_agent' }],
            details: [
              { id: 'args', label: 'Review details', content: 'secret' },
            ],
          },
        }}
      />
    );

    expect(screen.getByText('Input required')).toBeInTheDocument();
    expect(screen.getByText('Run shell_exec?')).toBeInTheDocument();
    expect(screen.queryByText('Technical context')).not.toBeInTheDocument();
    expect(screen.queryByText('single_agent')).not.toBeInTheDocument();
    expect(screen.queryByText('Review details')).not.toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('keeps a failed approval decision visible without restoring technical context', () => {
    render(
      <HumanDecisionCard
        requestKey="run:approval-error"
        variant={{
          ...approval(vi.fn()),
          header: { eyebrow: 'Input required', title: 'Run shell_exec?' },
          error: 'Approval could not be submitted.',
        }}
      />
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Approval could not be submitted.'
    );
  });

  it('requires a separate review action for a successor after the first request settles', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <HumanDecisionCard requestKey="run:request-1" variant={approval(first)} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(first).toHaveBeenCalledOnce();

    rerender(<HumanDecisionCard requestKey={null} variant={null} />);
    rerender(
      <HumanDecisionCard
        requestKey="run:request-2"
        variant={approval(second)}
      />
    );
    expect(screen.queryByRole('button', { name: 'Approve once' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Review next request' })
    );
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }));
    expect(second).toHaveBeenCalledOnce();
  });
});
