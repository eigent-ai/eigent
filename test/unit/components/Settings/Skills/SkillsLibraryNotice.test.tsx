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

import Skills from '@/components/Settings/Skills';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { library } = vi.hoisted(() => ({
  library: {
    entries: [] as never[],
    spaces: [] as never[],
    loading: false,
    errors: [] as string[],
    refresh: vi.fn(),
    openUpload: vi.fn(),
    updateGlobal: vi.fn(),
    updateGlobalMany: vi.fn(),
    pendingIds: new Set<string>(),
  },
}));

vi.mock('@/components/Settings/Skills/SkillsProvider', () => ({
  useSkillsLibrary: () => library,
}));

function renderSkills() {
  return render(
    <MemoryRouter>
      <Skills />
    </MemoryRouter>
  );
}

describe('Skills library load notice', () => {
  beforeEach(() => {
    library.entries = [];
    library.spaces = [];
    library.loading = false;
    library.errors = [
      'Global skills could not be refreshed.',
      'Could not load skills for Alpha.',
    ];
    library.pendingIds = new Set();
    library.refresh.mockReset();
    library.openUpload.mockReset();
  });

  it('styles the notice with information color and lets it be dismissed', async () => {
    const user = userEvent.setup();
    renderSkills();

    const notice = screen.getByRole('alert');
    expect(notice).toHaveClass('bg-ds-bg-information-subtle-default');
    expect(notice).toHaveClass('text-ds-text-information-strong-default');
    expect(notice).toHaveTextContent('Global skills could not be refreshed.');
    expect(within(notice).getByRole('button', { name: 'Retry' })).toBeVisible();

    await user.click(
      screen.getByRole('button', { name: 'Dismiss skill notice' })
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const toolbar = screen.getByRole('region', { name: 'Skills toolbar' });
    expect(
      within(toolbar).getByRole('heading', { name: 'Skills', level: 1 })
    ).toBeVisible();
    const retry = within(toolbar).getByRole('button', { name: 'Retry (2)' });
    expect(retry).toBeVisible();
    expect(retry).toHaveTextContent('2');

    await user.hover(retry);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Retry');

    await user.click(retry);
    expect(library.refresh).toHaveBeenCalledTimes(1);
  });

  it('retries from the notice card before it is dismissed', async () => {
    const user = userEvent.setup();
    renderSkills();

    await user.click(
      within(screen.getByRole('alert')).getByRole('button', { name: 'Retry' })
    );
    expect(library.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toBeVisible();
  });
});
