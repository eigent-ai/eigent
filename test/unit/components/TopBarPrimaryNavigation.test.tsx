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

import { TopBarPrimaryNavigation } from '@/components/TopBar/TopBarPrimaryNavigation';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function renderNavigation(sidebarHidden: boolean) {
  return render(
    <TopBarPrimaryNavigation
      sidebarHidden={sidebarHidden}
      leadingInset={68}
      sidebarControls={
        <>
          <button type="button">Toggle</button>
          <button type="button">Home</button>
        </>
      }
      contentControls={<button type="button">Space</button>}
    />
  );
}

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
      width: '172px',
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

  it('removes the fixed sidebar span when the sidebar is hidden', () => {
    const { container } = renderNavigation(true);
    const sidebarControls = container.querySelector(
      '[data-topbar-sidebar-controls]'
    );

    expect(sidebarControls).not.toHaveAttribute('style');
    expect(sidebarControls).not.toHaveClass('justify-between');
  });
});
