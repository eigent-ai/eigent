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
  getTopBarSidebarControlsWidth,
  TopBarPrimaryNavigation,
} from '@/components/TopBar/TopBarPrimaryNavigation';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function renderNavigation(sidebarHidden: boolean, leadingInset = 68) {
  return render(
    <TopBarPrimaryNavigation
      sidebarHidden={sidebarHidden}
      leadingInset={leadingInset}
      sidebarControls={<button type="button">Toggle</button>}
      contentControls={<button type="button">Space</button>}
    />
  );
}

describe('getTopBarSidebarControlsWidth', () => {
  it.each([
    // macOS traffic lights (68px): open spans rail 48 + sidebar 240 - 68.
    { sidebarHidden: false, leadingInset: 68, expected: 220 },
    // Folded, the lights are wider than the rail, so the span collapses.
    { sidebarHidden: true, leadingInset: 68, expected: 0 },
    // Windows / Linux / web (8px app padding).
    { sidebarHidden: false, leadingInset: 8, expected: 280 },
    { sidebarHidden: true, leadingInset: 8, expected: 40 },
  ])(
    'is $expected px with the sidebar hidden=$sidebarHidden and inset $leadingInset',
    ({ sidebarHidden, leadingInset, expected }) => {
      expect(getTopBarSidebarControlsWidth(sidebarHidden, leadingInset)).toBe(
        expected
      );
    }
  );
});

describe('TopBarPrimaryNavigation', () => {
  it('aligns expanded controls to the sidebar and content edges', () => {
    const { container } = renderNavigation(false);
    const sidebarControls = container.querySelector(
      '[data-topbar-sidebar-controls]'
    );
    const contentControls = container.querySelector(
      '[data-topbar-content-controls]'
    );
    const divider = container.querySelector('[data-topbar-primary-divider]');

    expect(sidebarControls).toHaveStyle({
      width: '220px',
      paddingRight: '4px',
    });
    expect(sidebarControls).toHaveClass('box-border', 'justify-between');
    expect(contentControls).toHaveStyle({ marginLeft: '2px' });
    expect(divider).toHaveClass(
      '-left-px',
      'h-5',
      'w-px',
      'bg-ds-border-neutral-subtle-default'
    );
  });

  it('lets folded controls follow the traffic lights when they cover the rail', () => {
    const { container } = renderNavigation(true);
    const sidebarControls = container.querySelector(
      '[data-topbar-sidebar-controls]'
    );

    expect(sidebarControls).not.toHaveAttribute('style');
    expect(sidebarControls).not.toHaveClass('justify-between');
  });

  it('keeps folded controls over the rail so the Space name meets the content edge', () => {
    const { container } = renderNavigation(true, 8);
    const sidebarControls = container.querySelector(
      '[data-topbar-sidebar-controls]'
    );

    expect(sidebarControls).toHaveStyle({ minWidth: '40px' });
    expect(sidebarControls).not.toHaveClass('justify-between');
  });
});
