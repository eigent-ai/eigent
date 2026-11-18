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
  HomeSidebarHost,
  HomeSidebarSlot,
} from '@/components/Home/HomeSidebarHost';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mounts = vi.hoisted(() => ({ count: 0 }));

vi.mock('@/components/Home/HomeSidebar', () => ({
  default: function HomeSidebarStub() {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return <aside aria-label="Home" />;
  },
}));

const page = (name: string, workspace = false) => (
  <section aria-label={name}>
    <HomeSidebarSlot workspace={workspace}>
      <aside aria-label="Alone" />
    </HomeSidebarSlot>
  </section>
);

describe('HomeSidebarHost', () => {
  beforeEach(() => {
    mounts.count = 0;
  });

  it('keeps one sidebar while it moves between pages', async () => {
    const { rerender } = render(
      <HomeSidebarHost enabled workspaceOnScreen>
        {page('Workspace', true)}
      </HomeSidebarHost>
    );
    const workspace = () => screen.getByRole('region', { name: 'Workspace' });
    expect(workspace()).toContainElement(await screen.findByLabelText('Home'));

    // The hidden Workspace stays mounted while the Home page shows it.
    rerender(
      <HomeSidebarHost enabled workspaceOnScreen={false}>
        {page('Workspace', true)}
        {page('Home page')}
      </HomeSidebarHost>
    );
    expect(screen.getByRole('region', { name: 'Home page' })).toContainElement(
      screen.getByLabelText('Home')
    );
    expect(workspace()).not.toContainElement(screen.getByLabelText('Home'));

    rerender(
      <HomeSidebarHost enabled workspaceOnScreen>
        {page('Workspace', true)}
      </HomeSidebarHost>
    );
    expect(workspace()).toContainElement(screen.getByLabelText('Home'));
    expect(mounts.count).toBe(1);
  });

  it('shows the page’s own sidebar outside a host', () => {
    render(page('Workspace'));

    expect(screen.getByLabelText('Alone')).toBeInTheDocument();
  });
});
