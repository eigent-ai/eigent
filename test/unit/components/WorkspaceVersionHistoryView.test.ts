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
  buildWorkspaceVersionHistoryView,
  technicalRefLabel,
} from '@/components/Workspace/workspaceVersionHistoryView';
import type { WorkspaceGitBranch } from '@/service/workspaceGitApi';
import { describe, expect, it } from 'vitest';

const branch = (
  ref: string,
  committedAt: number,
  overrides: Partial<WorkspaceGitBranch> = {}
): WorkspaceGitBranch => ({
  ref,
  oid: `${committedAt}`.padStart(40, '0'),
  committed_at: committedAt,
  subject: 'Saved version',
  archived: ref.startsWith('refs/eigent/archive/'),
  ...overrides,
});

describe('workspace version history view', () => {
  it('separates the current Space and Project versions from task refs', () => {
    const view = buildWorkspaceVersionHistoryView([
      branch('refs/heads/main', 50),
      branch('refs/heads/eigent/project/project-a', 40, {
        project_id: 'project-1',
      }),
      branch('refs/heads/eigent/project/project-b', 30, {
        project_id: 'project-2',
      }),
      branch('refs/eigent/archive/runs/run-a/integration', 40),
      branch('refs/eigent/archive/runs/run-a/agents/agent-a', 40),
      branch('refs/eigent/archive/runs/run-a/agents/agent-b', 39),
    ]);

    expect(view.currentSpace?.ref).toBe('refs/heads/main');
    expect(view.projectVersions.map((item) => item.project_id)).toEqual([
      'project-1',
      'project-2',
    ]);
    expect(view.taskVersions).toHaveLength(1);
    expect(view.taskVersions[0]).toMatchObject({
      id: 'archived:run-a',
      agentCount: 2,
      archived: true,
    });
    expect(view.taskVersions[0].branch.ref).toBe(
      'refs/eigent/archive/runs/run-a/integration'
    );
  });

  it('groups active Run and Agent refs without treating them as projects', () => {
    const view = buildWorkspaceVersionHistoryView([
      branch('refs/heads/trunk', 60, { archived: false }),
      branch('refs/heads/eigent/run/run-a', 55, { archived: false }),
      branch('refs/heads/eigent/agent/run-a/agent-a', 56, {
        archived: false,
      }),
    ]);

    expect(view.currentSpace?.ref).toBe('refs/heads/trunk');
    expect(view.projectVersions).toEqual([]);
    expect(view.taskVersions).toHaveLength(1);
    expect(view.taskVersions[0]).toMatchObject({
      id: 'active:run-a',
      agentCount: 1,
      archived: false,
    });
  });

  it('keeps raw refs available for technical details', () => {
    expect(
      technicalRefLabel('refs/eigent/archive/runs/run-a/integration')
    ).toBe('runs/run-a/integration');
    expect(technicalRefLabel('refs/heads/main')).toBe('main');
  });
});
