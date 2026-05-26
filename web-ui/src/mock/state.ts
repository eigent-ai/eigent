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

import type { ProjectGroup } from '@/types/history';
import {
  MOCK_BILLING,
  MOCK_PROFILE,
  MOCK_PROJECT_GROUPS,
  MOCK_USER,
} from '@web/mock/data';
import type { UserProfile } from '@web/types';

let projects: ProjectGroup[] = structuredClone(MOCK_PROJECT_GROUPS);
let profile: UserProfile = { ...MOCK_PROFILE };
let nextHistoryId = 1000;
let nextTaskNumericId = 1000;

function cloneProjects(): ProjectGroup[] {
  return structuredClone(projects);
}

export function getMockGroupedProjects(): ProjectGroup[] {
  return cloneProjects();
}

export function getMockProjectGroup(projectId: string): ProjectGroup | null {
  return (
    cloneProjects().find((project) => project.project_id === projectId) ?? null
  );
}

export function upsertMockProjectGroup(group: ProjectGroup): void {
  const index = projects.findIndex(
    (project) => project.project_id === group.project_id
  );
  if (index >= 0) {
    projects[index] = group;
  } else {
    projects.unshift(group);
  }
}

export function createMockProjectGroup(
  name: string,
  projectId: string
): ProjectGroup {
  const group: ProjectGroup = {
    project_id: projectId,
    project_name: name,
    total_tokens: 0,
    task_count: 0,
    total_triggers: 0,
    latest_task_date: new Date().toISOString(),
    last_prompt: '',
    tasks: [],
    total_completed_tasks: 0,
    total_ongoing_tasks: 0,
    average_tokens_per_task: 0,
  };
  upsertMockProjectGroup(group);
  return group;
}

export function appendMockTask(params: {
  projectId: string;
  taskId: string;
  question: string;
}): void {
  const project = projects.find((item) => item.project_id === params.projectId);
  if (!project) return;

  nextTaskNumericId += 1;
  project.tasks.push({
    id: nextTaskNumericId,
    task_id: params.taskId,
    project_id: params.projectId,
    question: params.question,
    language: 'en',
    model_platform: 'openai',
    model_type: 'gpt-5-mini',
    max_retries: 0,
    tokens: 0,
    status: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  project.task_count = project.tasks.length;
  project.total_ongoing_tasks = project.tasks.filter(
    (task) => task.status === 1
  ).length;
  project.total_completed_tasks = project.tasks.filter(
    (task) => task.status === 2
  ).length;
  project.last_prompt = params.question;
  project.latest_task_date = new Date().toISOString();
}

export function createMockHistoryRecord(): { id: number } {
  nextHistoryId += 1;
  return { id: nextHistoryId };
}

export function getMockUser() {
  return { ...MOCK_USER };
}

export function getMockBilling() {
  return { ...MOCK_BILLING };
}

export function getMockProfile() {
  return { ...profile };
}

export function updateMockProfile(next: UserProfile) {
  profile = { ...next };
  return profile;
}

export function resetMockState(): void {
  projects = structuredClone(MOCK_PROJECT_GROUPS);
  profile = { ...MOCK_PROFILE };
  nextHistoryId = 1000;
  nextTaskNumericId = 1000;
}
