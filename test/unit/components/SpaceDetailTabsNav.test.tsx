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

import {
  SpaceDetailTabsNav,
  type SpaceDetailTab,
} from '@/components/Home/SpaceDetailTabsNav';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function TabsHarness() {
  const [activeTab, setActiveTab] = useState<SpaceDetailTab>('projects');
  return <SpaceDetailTabsNav activeTab={activeTab} onChange={setActiveTab} />;
}

describe('SpaceDetailTabsNav', () => {
  beforeEach(() => {
    class TestPointerEvent extends MouseEvent {
      readonly pointerType: string;

      constructor(type: string, eventInit: PointerEventInit = {}) {
        super(type, eventInit);
        this.pointerType = eventInit.pointerType || '';
      }
    }
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(
      (callback) => {
        callback(0);
        return 1;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('preserves tab roles, roving focus, and instant keyboard navigation', () => {
    render(<TabsHarness />);

    const tablist = screen.getByRole('tablist', { name: 'Space content' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'id',
      'space-detail-tab-projects'
    );
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
      'aria-controls',
      'space-detail-panel-projects'
    );
    expect(
      screen.getByRole('tab', { name: 'Sessions' }).querySelector('svg')
    ).toHaveClass('lucide-message-circle');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Sessions' }), {
      key: 'ArrowRight',
    });
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveFocus();
    expect(tablist).toHaveAttribute('data-layout-movement', 'instant');

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tasks' }), {
      key: 'End',
    });
    expect(screen.getByRole('tab', { name: 'Space settings' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Space settings' }), {
      key: 'Home',
    });
    expect(screen.getByRole('tab', { name: 'Sessions' })).toHaveFocus();
  });

  it('keeps Enter, Space, and pointer selection feedback instant', () => {
    render(<TabsHarness />);
    const tablist = screen.getByRole('tablist', { name: 'Space content' });
    const tasksTab = screen.getByRole('tab', { name: 'Tasks' });
    const memoryTab = screen.getByRole('tab', { name: 'Memory' });

    fireEvent.keyDown(tasksTab, { key: 'Enter' });
    fireEvent.click(tasksTab);
    expect(tasksTab).toHaveAttribute('aria-selected', 'true');
    expect(tablist).toHaveAttribute('data-layout-movement', 'instant');

    fireEvent.keyDown(memoryTab, { key: ' ' });
    fireEvent.click(memoryTab);
    expect(memoryTab).toHaveAttribute('aria-selected', 'true');
    expect(tablist).toHaveAttribute('data-layout-movement', 'instant');

    fireEvent.pointerDown(tasksTab, { pointerType: 'mouse' });
    fireEvent.click(tasksTab);
    expect(tasksTab).toHaveAttribute('aria-selected', 'true');
    expect(tablist).toHaveAttribute('data-layout-movement', 'instant');
  });

  it('owns shared surfaces inside their tabs and clears hover for touch pointers', async () => {
    const { container } = render(<TabsHarness />);
    const projectsTab = screen.getByRole('tab', { name: 'Sessions' });
    const memoryTab = screen.getByRole('tab', { name: 'Memory' });

    expect(
      projectsTab.querySelector('[data-space-detail-tab-indicator]')
    ).toBeInTheDocument();
    fireEvent.pointerEnter(memoryTab, { pointerType: 'mouse' });
    expect(
      memoryTab.querySelector('[data-space-detail-tab-hover]')
    ).toBeInTheDocument();

    fireEvent.pointerEnter(projectsTab, { pointerType: 'touch' });
    await waitFor(() =>
      expect(
        container.querySelector('[data-space-detail-tab-hover]')
      ).not.toBeInTheDocument()
    );

    fireEvent.pointerEnter(memoryTab, { pointerType: 'mouse' });
    expect(
      memoryTab.querySelector('[data-space-detail-tab-hover]')
    ).toBeInTheDocument();
    fireEvent.pointerDown(projectsTab, { pointerType: 'touch' });
    await waitFor(() =>
      expect(
        container.querySelector('[data-space-detail-tab-hover]')
      ).not.toBeInTheDocument()
    );

    const indicator = container.querySelector(
      '[data-space-detail-tab-indicator]'
    ) as HTMLElement;
    expect(indicator.style.left).toBe('');
    expect(indicator.style.top).toBe('');
    expect(indicator.style.width).toBe('');
    expect(indicator.style.height).toBe('');
  });

  it('does not expose shared-layout animation state', () => {
    render(<TabsHarness />);

    expect(
      screen.getByRole('tablist', { name: 'Space content' })
    ).toHaveAttribute('data-layout-movement', 'instant');
  });
});
