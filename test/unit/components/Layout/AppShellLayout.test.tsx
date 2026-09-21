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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppShellLayout from '@/components/Layout/AppShellLayout';

const motionMocks = vi.hoisted(() => ({ reduced: false }));

vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motionMocks.reduced,
}));

describe('AppShellLayout', () => {
  beforeEach(() => {
    motionMocks.reduced = false;
  });

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
    expect(sidebarRail).toHaveAttribute('data-sidebar-motion', 'spring');

    rerender(renderShell(false));

    expect(sidebarRail).toHaveAttribute('aria-hidden', 'false');
    expect(sidebarRail).not.toHaveAttribute('inert');
  });

  it('makes sidebar folding instant when reduced motion is requested', () => {
    motionMocks.reduced = true;

    render(
      <AppShellLayout
        sidebar={<button type="button">Sidebar action</button>}
        sidebarHidden
      >
        <button type="button">Content action</button>
      </AppShellLayout>
    );

    expect(
      screen
        .getByRole('button', { name: 'Sidebar action', hidden: true })
        .closest('[aria-hidden]')
    ).toHaveAttribute('data-sidebar-motion', 'instant');
  });
});
