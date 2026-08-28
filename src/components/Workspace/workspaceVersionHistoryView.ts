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
  right.committed_at - left.committed_at;

const runGroupId = (ref: string) => {
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
    const id = runGroupId(branch.ref);
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
      archived: references.every((candidate) => candidate.archived),
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
