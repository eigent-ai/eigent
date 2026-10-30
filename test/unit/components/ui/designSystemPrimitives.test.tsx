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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  formFieldInputStateClasses,
  formFieldTextareaStateClasses,
} from '@/components/ui/formFieldSurface';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('design-system primitive foregrounds', () => {
  it('keeps primary button typography and inverse foreground together', () => {
    render(<Button>Continue</Button>);

    expect(screen.getByRole('button', { name: 'Continue' })).toHaveClass(
      '!text-ds-ink-inverse',
      '!text-ds-text-base'
    );
  });

  it('uses the success indicator foreground for an enabled switch thumb', () => {
    const { container } = render(<Switch defaultChecked />);
    const thumb = container.querySelector('[data-state="checked"] > span');

    expect(thumb).toHaveClass(
      'data-[state=checked]:bg-ds-success-indicator-on-default'
    );
  });

  it('uses the success indicator foreground for a checked checkbox mark', () => {
    const { container } = render(<Checkbox defaultChecked />);
    const mark = container.querySelector('svg');

    expect(mark).toHaveClass(
      'group-data-[state=checked]/checkbox:!text-ds-success-indicator-on-default'
    );
  });

  it('keeps compact labels, tags, and badges on the meta type role', () => {
    render(
      <>
        <Label>Field label</Label>
        <Tag size="lg">Tag label</Tag>
        <Badge size="sm">Badge label</Badge>
      </>
    );

    expect(screen.getByText('Field label')).toHaveClass('text-ds-text-meta');
    expect(screen.getByText('Tag label')).toHaveClass('!text-ds-text-meta');
    expect(screen.getByText('Badge label')).toHaveClass('!text-ds-text-meta');
  });

  it('keeps the default tab ring on a flex outer wrapper', () => {
    render(
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>
      </Tabs>
    );

    const tabList = screen.getByRole('tablist');

    expect(tabList.parentElement).toHaveClass(
      'flex',
      'ring-1',
      'ring-ds-hairline-default-default'
    );
    expect(tabList).not.toHaveClass('ring-1');
  });

  it('keeps field placeholders readable in every visual state', () => {
    const inputStates = [
      undefined,
      'default',
      'hover',
      'input',
      'error',
      'success',
      'disabled',
    ] as const;
    const textareaStates = inputStates;

    inputStates.forEach((state) => {
      expect(formFieldInputStateClasses(state).placeholder).toBe(
        'placeholder:text-ds-ink-muted-default'
      );
    });
    textareaStates.forEach((state) => {
      expect(formFieldTextareaStateClasses(state).placeholder).toBe(
        'placeholder:text-ds-ink-muted-default'
      );
    });
  });
});
