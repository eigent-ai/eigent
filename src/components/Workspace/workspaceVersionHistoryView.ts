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

import type { WorkspaceGitBranch } from '@/service/workspaceGitApi';

const PROJECT_REF_PREFIX = 'refs/heads/eigent/project/';
const ACTIVE_RUN_REF = /^refs\/heads\/eigent\/(run|agent)\/([^/]+)/;
const ARCHIVED_RUN_REF = /^refs\/eigent\/archive\/runs\/([^/]+)\//;
const DIRECT_TASK_REF =
  /^refs\/eigent\/tasks\/[0-9a-f]{32}\/(completed|recovery-failed|recovery-cancelled)$/;

export interface WorkspaceTaskVersion {
  id: string;
  branch: WorkspaceGitBranch;
  references: WorkspaceGitBranch[];
  agentCount: number;
  archived: boolean;
}

export interface WorkspaceVersionHistoryView {
  currentSpace: WorkspaceGitBranch | null;
  projectVersions: WorkspaceGitBranch[];
  taskVersions: WorkspaceTaskVersion[];
  technicalBranches: WorkspaceGitBranch[];
}

const newestFirst = (left: WorkspaceGitBranch, right: WorkspaceGitBranch) =>
  right.committed_at - left.committed_at || left.ref.localeCompare(right.ref);

const isDirectTaskVersion = (branch: WorkspaceGitBranch) =>
  DIRECT_TASK_REF.test(branch.ref) && !!branch.project_id && !!branch.run_id;

const runGroupId = (branch: WorkspaceGitBranch) => {
  const { ref } = branch;
  if (isDirectTaskVersion(branch)) return `direct:${branch.run_id}`;
  const archived = ref.match(ARCHIVED_RUN_REF);
  if (archived) return `archived:${archived[1]}`;
  const active = ref.match(ACTIVE_RUN_REF);
  return active ? `active:${active[2]}` : null;
};

const isAgentRef = (ref: string) =>
  ref.includes('/agents/') || ref.startsWith('refs/heads/eigent/agent/');

const isRunIntegrationRef = (ref: string) =>
  ref.endsWith('/integration') || ref.startsWith('refs/heads/eigent/run/');

export const buildWorkspaceVersionHistoryView = (
  branches: WorkspaceGitBranch[]
): WorkspaceVersionHistoryView => {
  const projectVersions = branches
    .filter((branch) => branch.ref.startsWith(PROJECT_REF_PREFIX))
    .sort(newestFirst);
  // Direct Tasks have no Session integration branch. Use the newest retained
  // Task boundary for that Session, merging with any existing managed version.
  for (const branch of branches.filter(isDirectTaskVersion).sort(newestFirst)) {
    const index = projectVersions.findIndex(
      (version) => version.project_id === branch.project_id
    );
    if (index === -1) {
      projectVersions.push(branch);
    } else if (branch.committed_at > projectVersions[index].committed_at) {
      projectVersions[index] = branch;
    }
  }
  projectVersions.sort(newestFirst);
  const currentSpace =
    branches.find((branch) => branch.ref === 'refs/heads/main') ??
    branches.find(
      (branch) =>
        branch.ref.startsWith('refs/heads/') &&
        !branch.ref.startsWith('refs/heads/eigent/')
    ) ??
    null;

  const groupedRuns = new Map<string, WorkspaceGitBranch[]>();
  for (const branch of branches) {
    const id = runGroupId(branch);
    if (!id) continue;
    const references = groupedRuns.get(id) ?? [];
    references.push(branch);
    groupedRuns.set(id, references);
  }

  const taskVersions = Array.from(groupedRuns, ([id, references]) => {
    references.sort(newestFirst);
    const branch =
      references.find((candidate) => isRunIntegrationRef(candidate.ref)) ??
      references[0];
    return {
      id,
      branch,
      references,
      agentCount: references.filter((candidate) => isAgentRef(candidate.ref))
        .length,
      // Direct refs retain terminal boundaries; they are not active branches.
      archived: references.every(
        (candidate) => candidate.archived || isDirectTaskVersion(candidate)
      ),
    };
  }).sort((left, right) => newestFirst(left.branch, right.branch));

  return {
    currentSpace,
    projectVersions,
    taskVersions,
    technicalBranches: [...branches].sort(newestFirst),
  };
};

export const technicalRefLabel = (ref: string) =>
  ref.replace(/^refs\/(heads|eigent\/archive)\//, '');
