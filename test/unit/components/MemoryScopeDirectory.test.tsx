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

import { MemoryScopeDirectory } from '@/components/Settings/Memory/MemoryScopeNotice';
import type { MemoryScopeState } from '@/service/memoryApi';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const directoryMocks = vi.hoisted(() => ({
  listMemoryEntries: vi.fn(),
  listMemoryScopeSummaries: vi.fn(),
}));

const spaceState = {
  spaces: {
    'space-1': {
      id: 'space-1',
      name: 'Design Space',
      sourceType: 'folder' as const,
      rootPath: '/design',
      status: 'active' as const,
      schemaVersion: 2,
      createdAt: 1,
      updatedAt: 10,
    },
    'space-2': {
      id: 'space-2',
      name: 'Research Space',
      sourceType: 'folder' as const,
      rootPath: '/research',
      status: 'active' as const,
      schemaVersion: 2,
      createdAt: 2,
      updatedAt: 20,
    },
  },
  projectsBySpaceId: {
    'space-1': {
      'project-1': {
        id: 'project-1',
        spaceId: 'space-1',
        name: 'Brand refresh',
        status: 'active' as const,
        createdAt: 1,
        updatedAt: 11,
      },
    },
    'space-2': {
      'project-2': {
        id: 'project-2',
        spaceId: 'space-2',
        name: 'Customer interviews',
        status: 'active' as const,
        createdAt: 2,
        updatedAt: 22,
      },
    },
  },
};

vi.mock('@/service/memoryApi', () => ({
  listMemoryEntries: directoryMocks.listMemoryEntries,
  listMemoryScopeSummaries: directoryMocks.listMemoryScopeSummaries,
}));

vi.mock('@/store/spaceStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/spaceStore')>()),
  useSpaceStore: (selector: (state: typeof spaceState) => unknown) =>
    selector(spaceState),
}));

function memoryState(
  scopeType: 'space' | 'project',
  scopeId: string,
  tokens: number
): MemoryScopeState {
  return {
    scope_type: scopeType,
    scope_id: scopeId,
    owner_kind: 'desktop',
    revision: 1,
    capture_enabled: scopeType === 'project',
    use_enabled: true,
    sync_scope: 'full_memory',
    token_limit: 640,
    current_token_count: tokens,
    consolidate_threshold: 0.75,
    processed_through_watermark: null,
    extractor_version: 'test',
    last_consolidated_at: null,
    last_error: null,
    updated_at: 1,
  };
}

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

describe('Memory scope directory', () => {
  beforeEach(() => {
    directoryMocks.listMemoryScopeSummaries.mockReset();
  });

  it('shows which Projects have Memory and sorts them first', async () => {
    directoryMocks.listMemoryScopeSummaries.mockResolvedValue({
      items: [
        {
          scope_type: 'project',
          scope_id: 'project-1',
          entry_count: 0,
          scope_state: memoryState('project', 'project-1', 0),
        },
        {
          scope_type: 'project',
          scope_id: 'project-2',
          entry_count: 3,
          scope_state: memoryState('project', 'project-2', 120),
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/home?section=settings&tab=memory']}>
        <MemoryScopeDirectory scopeType="project" />
        <CurrentLocation />
      </MemoryRouter>
    );

    expect(await screen.findByText('1 Session with Memory')).toBeVisible();
    expect(screen.getByText('3 saved notes total')).toBeVisible();
    expect(screen.getByPlaceholderText('Search Sessions')).toBeVisible();

    const rows = document.querySelectorAll('article');
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0] as HTMLElement).getByText('Customer interviews')
    ).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByText('Space: Research Space')
    ).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText('3 notes')).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByText('Brand refresh')
    ).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText('Empty')).toBeVisible();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', {
        name: 'Manage Memory for Customer interviews',
      })
    );
    expect(screen.getByTestId('location')).toHaveTextContent(
      '?section=spaces&spaceId=space-2&spaceTab=memory&memoryScope=project&projectId=project-2'
    );
  });

  it('uses the same searchable directory and Manage action for Spaces', async () => {
    directoryMocks.listMemoryScopeSummaries.mockResolvedValue({
      items: [
        {
          scope_type: 'space',
          scope_id: 'space-1',
          entry_count: 2,
          scope_state: memoryState('space', 'space-1', 80),
        },
        {
          scope_type: 'space',
          scope_id: 'space-2',
          entry_count: 0,
          scope_state: memoryState('space', 'space-2', 0),
        },
      ],
    });

    render(
      <MemoryRouter>
        <MemoryScopeDirectory scopeType="space" />
      </MemoryRouter>
    );

    expect(await screen.findByText('1 Space with Memory')).toBeVisible();
    expect(screen.getByPlaceholderText('Search Spaces')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Open Space Memory' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Manage Memory for Design Space' })
    ).toBeVisible();
  });

  it('falls back to existing per-scope reads while an older Brain is still running', async () => {
    directoryMocks.listMemoryScopeSummaries.mockRejectedValue(
      Object.assign(new Error('Not Found'), { status: 404 })
    );
    directoryMocks.listMemoryEntries.mockImplementation(
      (_scopeType: string, scopeId: string) =>
        Promise.resolve({
          items: scopeId === 'space-2' ? [{ memory_id: 'memory-1' }] : [],
          scope_state: memoryState(
            'space',
            scopeId,
            scopeId === 'space-2' ? 30 : 0
          ),
        })
    );

    render(
      <MemoryRouter>
        <MemoryScopeDirectory scopeType="space" />
      </MemoryRouter>
    );

    expect(await screen.findByText('1 Space with Memory')).toBeVisible();
    expect(directoryMocks.listMemoryEntries).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('button', {
        name: 'Manage Memory for Research Space',
      })
    ).toBeVisible();
  });
});
