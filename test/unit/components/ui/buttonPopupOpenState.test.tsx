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

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('Button popup open state', () => {
  it('keeps a ghost menu trigger selected while its menu is open', () => {
    const { rerender } = render(
      <DropdownMenu open={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" buttonContent="icon-only" aria-label="More">
            ...
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const trigger = screen.getByRole('button', { name: 'More' });
    expect(trigger).toHaveClass('bg-transparent');
    expect(trigger).not.toHaveClass('bg-ds-neutral-subtle-selected');

    rerender(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" buttonContent="icon-only" aria-label="More">
            ...
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

    const openTrigger = screen.getByRole('button', {
      name: 'More',
      hidden: true,
    });
    expect(openTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(openTrigger).toHaveClass(
      'bg-ds-neutral-subtle-selected',
      'hover:bg-ds-neutral-subtle-selected'
    );
    expect(openTrigger).not.toHaveClass(
      'bg-transparent',
      'hover:bg-ds-neutral-subtle-hover'
    );
  });

  it('marks an open popover trigger with the variant selected fill', () => {
    render(
      <Popover open>
        <PopoverTrigger asChild>
          <Button variant="secondary">Filters</Button>
        </PopoverTrigger>
        <PopoverContent>Panel</PopoverContent>
      </Popover>
    );

    expect(screen.getByRole('button', { name: 'Filters' })).toHaveClass(
      'bg-ds-neutral-muted-selected'
    );
  });

  it('lets a call site keep its own open fill', () => {
    render(
      <Button
        variant="ghost"
        aria-haspopup="listbox"
        aria-expanded
        className="bg-ds-neutral-strong-default"
      >
        Add
      </Button>
    );

    const trigger = screen.getByRole('button', { name: 'Add' });
    expect(trigger).toHaveClass('bg-ds-neutral-strong-default');
    expect(trigger).not.toHaveClass('bg-ds-neutral-subtle-selected');
  });

  it('does not treat a plain expanded toggle as a popup trigger', () => {
    render(
      <Button variant="ghost" aria-expanded>
        Details
      </Button>
    );

    expect(screen.getByRole('button', { name: 'Details' })).not.toHaveClass(
      'bg-ds-neutral-subtle-selected'
    );
  });
});
