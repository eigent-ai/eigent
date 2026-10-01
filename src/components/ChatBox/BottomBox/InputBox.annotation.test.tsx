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

import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Inputbox } from './InputBox';

describe('Inputbox annotation context', () => {
  it('shows one annotation with its full content on hover and enables annotation-only sending', async () => {
    const onSend = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <Inputbox
        value=""
        onSend={onSend}
        annotationContexts={[
          {
            id: 'note-1',
            contextLabel: 'Whole run',
            contextDetail: 'Final answer',
            runLabel: 'Run 12345678',
            selectedText: 'The original ending.',
            comment: 'Improve the ending with a more specific image.',
          },
        ]}
        onRemoveAnnotationContext={onRemove}
      />
    );

    const chip = screen.getByRole('button', { name: '1 annotation' });
    expect(
      chip.querySelector('.lucide-square-dashed-mouse-pointer')
    ).toBeInTheDocument();
    await user.hover(chip);
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('Whole run')).toBeInTheDocument();
    expect(
      within(tooltip).getByText('Run 12345678 · Final answer')
    ).toBeInTheDocument();
    expect(within(tooltip).getByText('Selected work')).toBeInTheDocument();
    expect(
      within(tooltip).getByText('The original ending.')
    ).toBeInTheDocument();
    expect(within(tooltip).getByText('Your comment')).toBeInTheDocument();
    expect(
      within(tooltip).getByText(
        'Improve the ending with a more specific image.'
      ).tagName
    ).toBe('SPAN');
    expect(tooltip.querySelector('.scrollbar-overlay')).toHaveClass(
      'max-h-[min(320px,var(--radix-tooltip-content-available-height))]',
      'overflow-y-auto'
    );
    expect(tooltip.querySelector('p')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove annotations from message',
      })
    );
    expect(onRemove).toHaveBeenCalledWith('note-1');
  });

  it('shows one count chip for multiple annotations and removes the group together', async () => {
    const onRemove = vi.fn();
    const user = userEvent.setup();
    render(
      <Inputbox
        annotationContexts={[
          {
            id: 'first',
            contextLabel: 'First source',
            runLabel: 'Run 11111111',
            comment: 'First full note.',
          },
          {
            id: 'second',
            contextLabel: 'Second source',
            runLabel: 'Run 22222222',
            comment: 'Second full note.',
          },
        ]}
        onRemoveAnnotationContext={onRemove}
      />
    );

    expect(
      screen.getAllByRole('button', { name: '2 annotations' })
    ).toHaveLength(1);
    await user.hover(screen.getByRole('button', { name: '2 annotations' }));
    const tooltip = await screen.findByRole('tooltip');
    expect(within(tooltip).getByText('First full note.')).toBeInTheDocument();
    expect(within(tooltip).getByText('Second full note.')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove annotations from message' })
    );
    expect(onRemove.mock.calls).toEqual([['first'], ['second']]);
  });
});
