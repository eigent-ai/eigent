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

import { ReviewAccordionContent } from '@/components/Session/PreviewPanel/tabs/review/ReviewAccordionContent';
import { render, screen } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReducedMotion = vi.hoisted(() => vi.fn(() => false));

vi.mock('framer-motion', async () => {
  const { forwardRef } = await import('react');
  type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
    initial?: unknown;
    animate?: unknown;
    exit?: unknown;
    transition?: unknown;
  };
  const MotionDiv = forwardRef<HTMLDivElement, MotionDivProps>(
    ({ initial, animate, exit, transition, ...props }, ref) => (
      <div
        ref={ref}
        data-motion-initial={JSON.stringify(initial)}
        data-motion-animate={JSON.stringify(animate)}
        data-motion-exit={JSON.stringify(exit)}
        data-motion-transition={JSON.stringify(transition)}
        {...props}
      />
    )
  );
  MotionDiv.displayName = 'MotionDiv';

  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: { div: MotionDiv },
    useReducedMotion: mockReducedMotion,
  };
});

describe('ReviewAccordionContent', () => {
  beforeEach(() => {
    mockReducedMotion.mockReturnValue(false);
  });

  it('folds and opens from the header edge', () => {
    const { rerender } = render(
      <ReviewAccordionContent open id="review-content">
        <div>Diff</div>
      </ReviewAccordionContent>
    );

    const content = screen.getByText('Diff').parentElement;
    expect(content).toHaveAttribute(
      'data-motion-initial',
      JSON.stringify({ height: 0, opacity: 0, y: -6 })
    );
    expect(content).toHaveAttribute(
      'data-motion-animate',
      JSON.stringify({ height: 'auto', opacity: 1, y: 0 })
    );
    expect(content).toHaveAttribute(
      'data-motion-exit',
      JSON.stringify({ height: 0, opacity: 0, y: -4 })
    );

    rerender(
      <ReviewAccordionContent open={false} id="review-content">
        <div>Diff</div>
      </ReviewAccordionContent>
    );
    expect(screen.queryByText('Diff')).not.toBeInTheDocument();
  });

  it('removes the transition when reduced motion is preferred', () => {
    mockReducedMotion.mockReturnValue(true);

    render(
      <ReviewAccordionContent open id="review-content">
        <div>Diff</div>
      </ReviewAccordionContent>
    );

    const content = screen.getByText('Diff').parentElement;
    expect(content).toHaveAttribute(
      'data-motion-initial',
      JSON.stringify({ height: 0 })
    );
    expect(content).toHaveAttribute(
      'data-motion-transition',
      JSON.stringify({ duration: 0 })
    );
  });
});
