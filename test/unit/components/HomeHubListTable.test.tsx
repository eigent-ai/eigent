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
  HomeHubCardMenu,
  HomeHubItemBody,
  HomeHubItemShell,
} from '@/components/Home/components/HomeHubItemShared';
import HomeHubListTable from '@/components/Home/components/HomeHubListTable';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('HomeHubListTable', () => {
  it('uses title case for the Tasks column in the Spaces table', () => {
    render(
      <HomeHubListTable kind="space">
        <div>Space row</div>
      </HomeHubListTable>
    );

    expect(screen.getByText('Tasks')).toBeVisible();
    expect(screen.queryByText('TASKS')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Spaces' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });

  it('removes the redundant Space column in Space detail', () => {
    render(
      <HomeHubListTable kind="project" hideSpaceColumn>
        <div role="row">
          <span role="cell">Session row</span>
        </div>
      </HomeHubListTable>
    );

    expect(screen.queryByRole('columnheader', { name: 'Space' })).toBeNull();
    expect(screen.getAllByRole('columnheader')).toHaveLength(4);
  });

  it('uses a real title button without making the row an interactive wrapper', () => {
    const onActivate = vi.fn();
    render(
      <HomeHubListTable kind="project">
        <HomeHubItemShell layout="list" kind="project" onClick={onActivate}>
          <HomeHubItemBody
            title="Forecast session"
            listCells={[
              { id: 'space', content: 'Finance' },
              { id: 'tasks', content: '2' },
              { id: 'triggers', content: '0' },
              { id: 'updated', content: '1h' },
            ]}
          />
        </HomeHubItemShell>
      </HomeHubListTable>
    );

    const row = screen.getAllByRole('row')[1];
    expect(row).not.toHaveAttribute('tabindex');
    const titleButton = within(row).getByRole('button', {
      name: 'Forecast session',
    });
    fireEvent.click(titleButton);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('underlines an interactive Space title on hover', () => {
    const onActivate = vi.fn();
    render(
      <HomeHubItemShell layout="card" kind="space" onClick={onActivate}>
        <HomeHubItemBody title="Design Space" />
      </HomeHubItemShell>
    );

    expect(screen.getByRole('button', { name: 'Design Space' })).toHaveClass(
      'hover:underline'
    );

    fireEvent.click(screen.getByText('Design Space').parentElement!);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('opens a Space from anywhere in its list row', () => {
    const onActivate = vi.fn();
    render(
      <HomeHubListTable kind="space">
        <HomeHubItemShell layout="list" kind="space" onClick={onActivate}>
          <HomeHubItemBody
            title="Design Space"
            listCells={[
              { id: 'type', content: 'Local' },
              { id: 'projects', content: '2' },
              { id: 'tasks', content: '4' },
              { id: 'triggers', content: '1' },
              { id: 'created', content: 'Today' },
            ]}
          />
        </HomeHubItemShell>
      </HomeHubListTable>
    );

    fireEvent.click(screen.getByText('Local'));

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('keeps nested Space actions independent from the row action', () => {
    const onActivate = vi.fn();
    const onNestedAction = vi.fn();
    render(
      <HomeHubItemShell layout="card" kind="space" onClick={onActivate}>
        <HomeHubItemBody title="Design Space" />
        <HomeHubCardMenu
          items={[
            {
              label: 'Rename',
              icon: null,
              onSelect: vi.fn(),
            },
          ]}
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onNestedAction();
          }}
        >
          Open workspace
        </button>
      </HomeHubItemShell>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

    expect(onNestedAction).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });
});
