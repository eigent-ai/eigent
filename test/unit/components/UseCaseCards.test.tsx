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

import { UseCaseCards } from '@/components/Workspace/UseCaseCards';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('UseCaseCards', () => {
  it('offers three starter use cases and View more', () => {
    const onViewMore = vi.fn();
    render(<UseCaseCards onSelectPrompt={vi.fn()} onViewMore={onViewMore} />);

    const section = screen.getByRole('region', { name: 'Try a use case' });
    const cards = Array.from(
      section.querySelectorAll<HTMLElement>('[data-use-case]')
    );
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Explore this folder'),
      expect.stringContaining('Get to know Eigent'),
      expect.stringContaining('Pick the right model'),
    ]);
    cards.forEach((card) =>
      // Compact icon-and-name rows by default, full cards from 36rem.
      expect(card).toHaveClass(
        'flex-row',
        'rounded-ds-menu-row',
        '@min-[36rem]:flex-col',
        '@min-[36rem]:rounded-ds-card',
        'border-ds-hairline-subtle-default'
      )
    );
    expect(
      within(cards[0]).getByText('See what we could work on here')
    ).toHaveClass('hidden', '@min-[36rem]:line-clamp-2');

    const viewMore = within(section).getByRole('button', {
      name: 'View more',
    });
    expect(viewMore.querySelector('svg')).toBeNull();
    fireEvent.click(viewMore);
    expect(onViewMore).toHaveBeenCalledTimes(1);
  });

  it('hands the full prompt to the composer when a card is chosen', () => {
    const onSelectPrompt = vi.fn();
    render(
      <UseCaseCards onSelectPrompt={onSelectPrompt} onViewMore={vi.fn()} />
    );

    fireEvent.click(screen.getByRole('button', { name: /Get to know Eigent/ }));
    expect(onSelectPrompt).toHaveBeenCalledWith(
      expect.stringContaining('www.eigent.ai')
    );
    expect(onSelectPrompt.mock.calls[0][0]).toContain('interactive HTML');
  });
});
