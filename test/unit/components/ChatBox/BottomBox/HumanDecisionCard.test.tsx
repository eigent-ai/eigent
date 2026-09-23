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
