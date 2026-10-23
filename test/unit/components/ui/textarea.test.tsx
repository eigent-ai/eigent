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

import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const NONE_CLASSES =
  'flex min-h-[4rem] w-full [scrollbar-gutter:stable] rounded-ds-field border border-x border-y border-ds-hairline-default-default bg-transparent py-2 pr-3 pl-3 text-ds-text-base shadow-sm placeholder:text-ds-ink-muted-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

describe('Textarea variants', () => {
  it('renders plain without an inner frame and with the shared focus ring', () => {
    render(<Textarea aria-label="Answer" variant="plain" size="sm" />);
    const textarea = screen.getByRole('textbox', { name: 'Answer' });

    expect(textarea).toHaveClass(
      'p-0',
      'border-0',
      'shadow-none',
      'bg-transparent',
      'rounded-ds-field',
      'min-h-[var(--ds-textarea-sm-min-height)]',
      'outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-ds-ring-focus',
      'focus-visible:ring-offset-2'
    );
    expect(textarea).not.toHaveClass(
      'py-2',
      'pl-3',
      'pr-3',
      'border',
      'border-ds-hairline-default-default',
      'shadow-sm'
    );
    expect(textarea.style.paddingRight).toBe('');
  });

  it('uses the default textarea min-height token for plain at the default size', () => {
    render(<Textarea aria-label="Answer" variant="plain" />);

    expect(screen.getByRole('textbox', { name: 'Answer' })).toHaveClass(
      'min-h-[var(--ds-textarea-md-min-height)]'
    );
  });

  it('keeps the none variant classes and padding unchanged', () => {
    render(<Textarea aria-label="Notes" />);
    const textarea = screen.getByRole('textbox', { name: 'Notes' });

    expect(textarea).toHaveAttribute('class', cn(NONE_CLASSES));
    expect(textarea.style.paddingRight).toBe('4px');
  });
});
