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

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AppShellLayout from '@/components/Layout/AppShellLayout';

describe('AppShellLayout', () => {
  afterEach(cleanup);

  it('makes the workspace sidebar inert while it animates closed', () => {
    const renderShell = (sidebarHidden: boolean) => (
      <AppShellLayout
        sidebar={<button type="button">Sidebar action</button>}
        sidebarHidden={sidebarHidden}
      >
        <button type="button">Content action</button>
      </AppShellLayout>
    );

    const { rerender } = render(renderShell(true));
    const sidebarAction = screen.getByRole('button', {
      name: 'Sidebar action',
      hidden: true,
    });
    const sidebarRail = sidebarAction.closest('[aria-hidden]');

    expect(sidebarRail).toHaveAttribute('aria-hidden', 'true');
    expect(sidebarRail).toHaveAttribute('inert', '');

    rerender(renderShell(false));

    expect(sidebarRail).toHaveAttribute('aria-hidden', 'false');
    expect(sidebarRail).not.toHaveAttribute('inert');
  });
});
