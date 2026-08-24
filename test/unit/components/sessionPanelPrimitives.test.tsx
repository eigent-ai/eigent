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

import { SidePanelAccordionBox } from '@/components/Session/SidePanel/components/AccordionBox';
import { SessionPanelCollapse } from '@/components/Session/SidePanel/sections/primitives';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('SessionPanelCollapse', () => {
  it('removes collapsed content from keyboard navigation', () => {
    const { container, rerender } = render(
      <SessionPanelCollapse open={false}>
        <button type="button">Hidden action</button>
      </SessionPanelCollapse>
    );

    expect(container.firstElementChild).toHaveAttribute('inert');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');

    rerender(
      <SessionPanelCollapse open>
        <button type="button">Visible action</button>
      </SessionPanelCollapse>
    );

    expect(container.firstElementChild).not.toHaveAttribute('inert');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'false');
  });
});

describe('SidePanelAccordionBox', () => {
  it('keeps top-level section headers sticky within their section', () => {
    const { container } = render(
      <SidePanelAccordionBox title="Resources">
        <div>Resource rows</div>
      </SidePanelAccordionBox>
    );

    const trigger = screen.getByRole('button', { name: 'Resources' });
    const header = trigger.parentElement?.parentElement;
    expect(header).toHaveClass('sticky', 'top-0');
    expect(container.firstElementChild).toHaveClass('overflow-visible');
  });

  it('does not pin nested subcategory headers', () => {
    render(
      <SidePanelAccordionBox title="Skills" rowVariant="subcategory">
        <div>Skill rows</div>
      </SidePanelAccordionBox>
    );

    const trigger = screen.getByRole('button', { name: 'Skills' });
    const header = trigger.parentElement?.parentElement;
    expect(header).not.toHaveClass('sticky');
  });

  it('supports lifecycle-controlled state while reporting user toggles', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SidePanelAccordionBox
        title="Agents"
        open={false}
        onOpenChange={onOpenChange}
      >
        <div>Agent rows</div>
      </SidePanelAccordionBox>
    );

    const trigger = screen.getByRole('button', { name: 'Agents' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(true);

    rerender(
      <SidePanelAccordionBox title="Agents" open onOpenChange={onOpenChange}>
        <div>Agent rows</div>
      </SidePanelAccordionBox>
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
