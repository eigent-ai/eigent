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

import { WorkspaceVersionHistoryDialog } from '@/components/Workspace/WorkspaceVersionHistoryDialog';
import { buildWorkspaceVersionHistoryView } from '@/components/Workspace/workspaceVersionHistoryView';
import type { WorkspaceGitHistory } from '@/service/workspaceGitApi';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The global translation mock creates a fresh t on every render, unlike the
// real hook; this dialog's load effect depends on the stable production t.
vi.unmock('react-i18next');
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/service/workspaceGitApi', () => ({
  fetchWorkspaceGitHistory: api.fetch,
  executeAdvancedGit: vi.fn(),
  previewAdvancedGit: vi.fn(),
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({ projectsBySpaceId: {} }),
  getVisibleProjectMetasForSpace: () => [
    { id: 'session-a', name: 'Design session' },
    { id: 'session-b', name: 'Research session' },
  ],
}));

interface HistoryFixture {
  technical_only: WorkspaceGitHistory;
  direct: WorkspaceGitHistory;
  with_orphans: WorkspaceGitHistory;
  limited: WorkspaceGitHistory;
  mixed: WorkspaceGitHistory;
  direct_refs: string[];
  technical_refs: string[];
  legacy_refs: string[];
  managed_ref: string;
  managed_project_ref: string;
  oids: Record<string, string>;
}

// Cross-language integration: point this at the installed backend environment.
// EIGENT_TEST_PYTHON=backend/.venv/bin/python npx vitest run <this file>
const python = process.env.EIGENT_TEST_PYTHON;
describe.skipIf(!python)('real Git history API → mapper → dialog', () => {
  let fixture: HistoryFixture;
  beforeAll(() => {
    fixture = JSON.parse(
      execFileSync(
        path.resolve(python!),
        ['tests/app/workspace_git/history_fixture.py'],
        {
          cwd: path.resolve('backend'),
          env: { ...process.env, PYTHONPATH: '.' },
          encoding: 'utf8',
        }
      )
    );
  });
  afterEach(() => {
    cleanup();
    document.documentElement.classList.remove('dark');
  });

  it('counts two Sessions and three Tasks while preserving actual checkpoints', () => {
    const view = buildWorkspaceVersionHistoryView(fixture.direct.branches);
    expect(view.projectVersions.map((branch) => branch.project_id)).toEqual([
      'session-a',
      'session-b',
    ]);
    expect(view.taskVersions.map((task) => task.branch.run_id)).toEqual([
      'task-a',
      'task-c',
      'task-b',
    ]);
    expect(view.taskVersions[0].references).toHaveLength(2);
    expect(view.taskVersions[0].branch.oid).toBe(fixture.oids['task-a']);
    expect(view.taskVersions.every((task) => task.agentCount === 0)).toBe(true);
    expect(view.taskVersions.every((task) => task.archived)).toBe(true);
    expect(fixture.direct.commits.map((commit) => commit.oid)).toEqual(
      expect.arrayContaining(Object.values(fixture.oids))
    );
    expect(view.technicalBranches.map((branch) => branch.ref)).toEqual(
      expect.arrayContaining(fixture.direct_refs)
    );
  });

  it('does not manufacture ownership from unrelated commits or unresolved refs', () => {
    const empty = buildWorkspaceVersionHistoryView(
      fixture.technical_only.branches
    );
    expect(fixture.technical_only.commits.length).toBeGreaterThan(0);
    expect(empty.projectVersions).toHaveLength(0);
    expect(empty.taskVersions).toHaveLength(0);
    for (const history of [fixture.with_orphans, fixture.limited]) {
      const view = buildWorkspaceVersionHistoryView(history.branches);
      expect(view.projectVersions).toHaveLength(2);
      expect(view.taskVersions).toHaveLength(3);
      expect(view.technicalBranches.map((branch) => branch.ref)).toEqual(
        expect.arrayContaining(fixture.technical_refs)
      );
    }
  });

  it('preserves managed and legacy groups without counting a Session twice', () => {
    const view = buildWorkspaceVersionHistoryView(fixture.mixed.branches);
    expect(view.projectVersions).toHaveLength(3);
    expect(
      view.projectVersions.filter((branch) => branch.project_id === 'session-a')
    ).toHaveLength(1);
    expect(view.taskVersions).toHaveLength(6);
    expect(view.taskVersions.map((task) => task.branch.ref)).toContain(
      fixture.managed_ref
    );
    expect(
      view.taskVersions.find((task) => task.id === 'archived:legacy-task')
    ).toMatchObject({
      archived: true,
      agentCount: 1,
    });
    expect(
      view.taskVersions.find((task) => task.id === 'active:legacy-active')
    ).toMatchObject({
      archived: false,
      agentCount: 1,
    });
    expect(view.technicalBranches).toHaveLength(fixture.mixed.branches.length);
  });

  it.each(['light', 'dark'])(
    'renders counts and Session names in the existing %s dialog',
    async (theme) => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      api.fetch.mockResolvedValue(fixture.direct);
      render(
        <I18nextProvider i18n={i18next}>
          <WorkspaceVersionHistoryDialog
            open
            onOpenChange={vi.fn()}
            spaceId="space-1"
            email="fixture@example.com"
            userId="user-1"
            actorId="user-1"
          />
        </I18nextProvider>
      );
      const sessions = await screen.findByRole('tab', {
        name: 'Session versions 2',
      });
      expect(sessions).toHaveAttribute('aria-selected', 'true');
      await waitFor(() =>
        expect(
          screen.getByRole('tab', { name: 'Task versions 3' })
        ).toBeVisible()
      );
      expect(
        within(screen.getByRole('tabpanel')).getByText('Design session')
      ).toBeVisible();
      expect(
        within(screen.getByRole('tabpanel')).getByText('Research session')
      ).toBeVisible();
      // Use the real Tabs keyboard interaction to reach the Task entries.
      const user = userEvent.setup();
      act(() => sessions.focus());
      await user.keyboard('{ArrowRight}');
      expect(
        screen.getByRole('tab', { name: 'Task versions 3' })
      ).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() =>
        expect(
          screen.getByRole('tab', { name: 'Task versions 3' })
        ).toHaveAttribute('aria-selected', 'true')
      );
      const tasks = screen.getByRole('tabpanel');
      expect(within(tasks).getAllByText('Design session')).toHaveLength(2);
      expect(within(tasks).getAllByText('Retained')).toHaveLength(3);
      await waitFor(() =>
        expect(within(tasks).getByText('Research session')).toBeVisible()
      );
      await user.click(screen.getByRole('tab', { name: /Timeline/ }));
      await waitFor(() =>
        expect(screen.getByText('Checkpoint task-a')).toBeVisible()
      );
      await user.click(screen.getByRole('tab', { name: 'Technical' }));
      await waitFor(() =>
        expect(screen.getByText(fixture.direct_refs[0])).toBeVisible()
      );
    }
  );
});
