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

import { SidebarShell } from '@/components/Layout/AppSidebar';
import {
  SIDEBAR_TOOLTIP_GAP_PX,
  SidebarRowTooltip,
} from '@/components/Layout/AppSidebar/SidebarTooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function rect(top: number, right: number, height = 32): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right,
    width: right,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function renderRows() {
  render(
    <SidebarShell ariaLabel="Home">
      <SidebarRowTooltip content="Research">
        <button type="button">Research row</button>
      </SidebarRowTooltip>
      <SidebarRowTooltip content="Ops">
        <button type="button">Ops row</button>
      </SidebarRowTooltip>
    </SidebarShell>
  );
  const sidebar = screen.getByRole('complementary', { name: 'Home' });
  const research = screen.getByRole('button', { name: 'Research row' });
  const ops = screen.getByRole('button', { name: 'Ops row' });
  vi.spyOn(sidebar, 'getBoundingClientRect').mockReturnValue(rect(0, 240, 600));
  vi.spyOn(research, 'getBoundingClientRect').mockReturnValue(rect(100, 200));
  vi.spyOn(ops, 'getBoundingClientRect').mockReturnValue(rect(134, 200));
  return { research, ops };
}

const shell = () =>
  document.querySelector<HTMLElement>('[data-sidebar-tooltip]');

describe('SidebarRowTooltip', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows one shell outside the sidebar, moving between rows with new text', () => {
    const { research, ops } = renderRows();

    fireEvent.pointerEnter(research, { pointerType: 'mouse' });
    act(() => vi.runOnlyPendingTimers());
    const first = shell();
    expect(first).toHaveTextContent('Research');
    // A fixed gap past the sidebar's right edge, not over the row.
    expect(first).toHaveStyle({ left: `${240 + SIDEBAR_TOOLTIP_GAP_PX}px` });

    // Moving to the next row keeps the same element and swaps the text.
    fireEvent.pointerLeave(research, { pointerType: 'mouse' });
    fireEvent.pointerEnter(ops, { pointerType: 'mouse' });
    act(() => vi.runOnlyPendingTimers());
    expect(shell()).toBe(first);
    expect(shell()).toHaveTextContent('Ops');
    expect(document.querySelectorAll('[data-sidebar-tooltip]')).toHaveLength(1);
  });

  it('closes after leaving the rows, and on a click', () => {
    const { research } = renderRows();

    fireEvent.pointerEnter(research, { pointerType: 'mouse' });
    act(() => vi.runOnlyPendingTimers());
    fireEvent.pointerLeave(research, { pointerType: 'mouse' });
    act(() => vi.runOnlyPendingTimers());
    expect(shell()).toBeNull();

    fireEvent.pointerEnter(research, { pointerType: 'mouse' });
    act(() => vi.runOnlyPendingTimers());
    expect(shell()).not.toBeNull();
    fireEvent.pointerDown(research);
    expect(shell()).toBeNull();
  });

  it('falls back to a normal tooltip outside a sidebar', () => {
    render(
      <SidebarRowTooltip content="Alone">
        <button type="button">Alone row</button>
      </SidebarRowTooltip>
    );
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Alone row' }), {
      pointerType: 'mouse',
    });
    act(() => vi.runOnlyPendingTimers());
    expect(shell()).toBeNull();
  });
});
