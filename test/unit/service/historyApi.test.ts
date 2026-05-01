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

/**
 * historyApi Unit Tests
 *
 * Tests all exported history API functions and grouping logic:
 * - fetchHistoryTasks: fetches and sets items, error fallback to []
 * - fetchGroupedHistoryTasks: backend grouped endpoint, fallback to legacy
 * - fetchGroupedHistorySummaries: summaries without tasks, fallback to legacy
 * - fetchGroupedHistoryTasksLegacy: flat fetch + client-side grouping
 * - flattenProjectTasks: utility to flatten grouped projects
 * - Internal groupTasksByProject: grouping, aggregation, sorting
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockProxyFetchGet = vi.fn();

vi.mock('@/api/http', () => ({
  get proxyFetchGet() {
    return mockProxyFetchGet;
  },
}));

// ── Import after mocks ───────────────────────────────────────────────────

import {
  fetchGroupedHistorySummaries,
  fetchGroupedHistoryTasks,
  fetchGroupedHistoryTasksLegacy,
  fetchHistoryTasks,
  flattenProjectTasks,
} from '@/service/historyApi';
import { HistoryTask, ProjectGroup } from '@/types/history';

// ── Test Data Factories ──────────────────────────────────────────────────

/** Create a HistoryTask with sensible defaults. */
function createHistoryTask(overrides: Partial<HistoryTask> = {}): HistoryTask {
  return {
    id: Math.floor(Math.random() * 10000),
    task_id: `task-${Math.random().toString(36).slice(2, 8)}`,
    project_id: 'proj-default',
    question: 'What is the meaning of life?',
    language: 'en',
    model_platform: 'openai',
    model_type: 'gpt-4',
    max_retries: 3,
    tokens: 100,
    status: 2,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('historyApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── fetchHistoryTasks ───────────────────────────────────────────

  describe('fetchHistoryTasks', () => {
    it('should call proxyFetchGet and pass res.items to setTasks', async () => {
      const items = [createHistoryTask(), createHistoryTask()];
      mockProxyFetchGet.mockResolvedValueOnce({ items, total: 2 });
      const setTasks = vi.fn();

      await fetchHistoryTasks(setTasks);

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/chat/histories');
      expect(setTasks).toHaveBeenCalledWith(items);
    });

    it('should call setTasks([]) on error', async () => {
      mockProxyFetchGet.mockRejectedValueOnce(new Error('Network error'));
      const setTasks = vi.fn();

      await fetchHistoryTasks(setTasks);

      expect(setTasks).toHaveBeenCalledWith([]);
    });
  });

  // ─── fetchGroupedHistoryTasks ────────────────────────────────────

  describe('fetchGroupedHistoryTasks', () => {
    it('should set projects from backend response when res.projects exists', async () => {
      const projects: ProjectGroup[] = [
        {
          project_id: 'proj-1',
          project_name: 'Project 1',
          total_tokens: 500,
          task_count: 5,
          total_triggers: 0,
          latest_task_date: '2026-04-01T00:00:00Z',
          last_prompt: 'Hello',
          tasks: [],
          total_completed_tasks: 3,
          total_ongoing_tasks: 2,
          average_tokens_per_task: 100,
        },
      ];
      mockProxyFetchGet.mockResolvedValueOnce({ projects, total_projects: 1 });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasks(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledWith(
        '/api/v1/chat/histories/grouped?include_tasks=true'
      );
      expect(setProjects).toHaveBeenCalledWith(projects);
    });

    it('should fall back to legacy when res is null', async () => {
      // First call returns null (grouped endpoint), second call is legacy
      mockProxyFetchGet
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ items: [createHistoryTask()] });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasks(setProjects);

      // Second call should be the legacy flat endpoint
      expect(mockProxyFetchGet).toHaveBeenCalledTimes(2);
      expect(mockProxyFetchGet).toHaveBeenNthCalledWith(
        2,
        '/api/v1/chat/histories'
      );
      expect(setProjects).toHaveBeenCalled();
    });

    it('should fall back to legacy when res.projects is undefined', async () => {
      mockProxyFetchGet
        .mockResolvedValueOnce({ total: 0 }) // no projects field
        .mockResolvedValueOnce({ items: [createHistoryTask()] });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasks(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledTimes(2);
      expect(setProjects).toHaveBeenCalled();
    });

    it('should fall back to legacy on error', async () => {
      mockProxyFetchGet
        .mockRejectedValueOnce(new Error('Grouped endpoint failed'))
        .mockResolvedValueOnce({ items: [createHistoryTask()] });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasks(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledTimes(2);
      expect(setProjects).toHaveBeenCalled();
    });
  });

  // ─── fetchGroupedHistorySummaries ────────────────────────────────

  describe('fetchGroupedHistorySummaries', () => {
    it('should call proxyFetchGet with include_tasks=false', async () => {
      const projects: ProjectGroup[] = [
        {
          project_id: 'proj-1',
          project_name: 'Project 1',
          total_tokens: 500,
          task_count: 5,
          total_triggers: 0,
          latest_task_date: '2026-04-01T00:00:00Z',
          last_prompt: 'Hello',
          tasks: [],
          total_completed_tasks: 3,
          total_ongoing_tasks: 2,
          average_tokens_per_task: 100,
        },
      ];
      mockProxyFetchGet.mockResolvedValueOnce({ projects });
      const setProjects = vi.fn();

      await fetchGroupedHistorySummaries(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledWith(
        '/api/v1/chat/histories/grouped?include_tasks=false'
      );
      expect(setProjects).toHaveBeenCalledWith(projects);
    });

    it('should fall back to legacy when res.projects is missing', async () => {
      mockProxyFetchGet
        .mockResolvedValueOnce({ data: 'no projects' })
        .mockResolvedValueOnce({ items: [createHistoryTask()] });
      const setProjects = vi.fn();

      await fetchGroupedHistorySummaries(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledTimes(2);
      expect(setProjects).toHaveBeenCalled();
    });

    it('should fall back to legacy on error', async () => {
      mockProxyFetchGet
        .mockRejectedValueOnce(new Error('Summaries endpoint failed'))
        .mockResolvedValueOnce({ items: [] });
      const setProjects = vi.fn();

      await fetchGroupedHistorySummaries(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledTimes(2);
    });
  });

  // ─── fetchGroupedHistoryTasksLegacy ──────────────────────────────

  describe('fetchGroupedHistoryTasksLegacy', () => {
    it('should fetch flat list and group by project_id', async () => {
      const task1 = createHistoryTask({
        id: 1,
        project_id: 'proj-a',
        project_name: 'Alpha',
        tokens: 100,
        status: 2,
        created_at: '2026-03-01T10:00:00Z',
      });
      const task2 = createHistoryTask({
        id: 2,
        project_id: 'proj-a',
        project_name: 'Alpha',
        tokens: 200,
        status: 1,
        created_at: '2026-03-02T10:00:00Z',
      });
      const task3 = createHistoryTask({
        id: 3,
        project_id: 'proj-b',
        project_name: 'Beta',
        tokens: 50,
        status: 2,
        created_at: '2026-03-03T10:00:00Z',
      });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [task1, task2, task3],
        total: 3,
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/chat/histories');
      expect(setProjects).toHaveBeenCalledTimes(1);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped).toHaveLength(2);

      // proj-b has the latest task date → should be first after sorting
      const projB = grouped.find((g) => g.project_id === 'proj-b')!;
      const projA = grouped.find((g) => g.project_id === 'proj-a')!;

      expect(projB).toBeDefined();
      expect(projA).toBeDefined();

      // Verify grouping
      expect(projA.tasks).toHaveLength(2);
      expect(projB.tasks).toHaveLength(1);

      // Verify token aggregation
      expect(projA.total_tokens).toBe(300);
      expect(projB.total_tokens).toBe(50);

      // Verify task_count
      expect(projA.task_count).toBe(2);
      expect(projB.task_count).toBe(1);

      // Verify completed count (status === 2)
      expect(projA.total_completed_tasks).toBe(1);
      expect(projB.total_completed_tasks).toBe(1);

      // Verify ongoing count (status === 1)
      expect(projA.total_ongoing_tasks).toBe(1);
      expect(projB.total_ongoing_tasks).toBe(0);
    });

    it('should sort tasks within each project by created_at newest first', async () => {
      const olderTask = createHistoryTask({
        id: 1,
        project_id: 'proj-a',
        created_at: '2026-01-01T00:00:00Z',
      });
      const newerTask = createHistoryTask({
        id: 2,
        project_id: 'proj-a',
        created_at: '2026-06-01T00:00:00Z',
      });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [olderTask, newerTask],
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      const proj = grouped[0];
      // Newest task first
      expect(proj.tasks[0].id).toBe(2);
      expect(proj.tasks[1].id).toBe(1);
    });

    it('should sort projects by latest_task_date newest first', async () => {
      const taskOld = createHistoryTask({
        project_id: 'proj-old',
        created_at: '2025-01-01T00:00:00Z',
      });
      const taskNew = createHistoryTask({
        project_id: 'proj-new',
        created_at: '2026-12-31T00:00:00Z',
      });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [taskOld, taskNew],
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped[0].project_id).toBe('proj-new');
      expect(grouped[1].project_id).toBe('proj-old');
    });

    it('should calculate average_tokens_per_task', async () => {
      const task1 = createHistoryTask({ project_id: 'proj-x', tokens: 150 });
      const task2 = createHistoryTask({ project_id: 'proj-x', tokens: 250 });
      const task3 = createHistoryTask({ project_id: 'proj-x', tokens: 200 });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [task1, task2, task3],
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped[0].average_tokens_per_task).toBe(200);
    });

    it('should handle tasks without tokens (defaulting to 0)', async () => {
      const task = createHistoryTask({ project_id: 'proj-y', tokens: 0 });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [task],
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped[0].total_tokens).toBe(0);
      expect(grouped[0].average_tokens_per_task).toBe(0);
    });

    it('should use "Project {id}" as default name when project_name is missing', async () => {
      const task = createHistoryTask({
        project_id: 'abc-123',
        project_name: undefined,
      });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [task],
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped[0].project_name).toBe('Project abc-123');
    });

    it('should use the first task question as last_prompt', async () => {
      const task = createHistoryTask({
        project_id: 'proj-prompt',
        question: 'My first question',
      });

      mockProxyFetchGet.mockResolvedValueOnce({
        items: [task],
      });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped[0].last_prompt).toBe('My first question');
    });

    it('should set setProjects([]) on error', async () => {
      mockProxyFetchGet.mockRejectedValueOnce(new Error('Server error'));
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      expect(setProjects).toHaveBeenCalledWith([]);
    });

    it('should handle empty items array', async () => {
      mockProxyFetchGet.mockResolvedValueOnce({ items: [], total: 0 });
      const setProjects = vi.fn();

      await fetchGroupedHistoryTasksLegacy(setProjects);

      const grouped = (setProjects as any).mock.calls[0][0] as ProjectGroup[];
      expect(grouped).toEqual([]);
    });
  });

  // ─── flattenProjectTasks ─────────────────────────────────────────

  describe('flattenProjectTasks', () => {
    it('should return a flat array of all tasks from all projects', () => {
      const task1 = createHistoryTask({ id: 1, project_id: 'a' });
      const task2 = createHistoryTask({ id: 2, project_id: 'a' });
      const task3 = createHistoryTask({ id: 3, project_id: 'b' });

      const projects: ProjectGroup[] = [
        {
          project_id: 'a',
          project_name: 'Alpha',
          total_tokens: 200,
          task_count: 2,
          total_triggers: 0,
          latest_task_date: '2026-04-01T00:00:00Z',
          last_prompt: 'Hello',
          tasks: [task1, task2],
          total_completed_tasks: 2,
          total_ongoing_tasks: 0,
          average_tokens_per_task: 100,
        },
        {
          project_id: 'b',
          project_name: 'Beta',
          total_tokens: 100,
          task_count: 1,
          total_triggers: 0,
          latest_task_date: '2026-04-02T00:00:00Z',
          last_prompt: 'World',
          tasks: [task3],
          total_completed_tasks: 1,
          total_ongoing_tasks: 0,
          average_tokens_per_task: 100,
        },
      ];

      const flat = flattenProjectTasks(projects);

      expect(flat).toHaveLength(3);
      expect(flat).toEqual([task1, task2, task3]);
    });

    it('should return empty array for empty projects input', () => {
      expect(flattenProjectTasks([])).toEqual([]);
    });

    it('should return empty array when all projects have empty task lists', () => {
      const projects: ProjectGroup[] = [
        {
          project_id: 'a',
          project_name: 'Empty',
          total_tokens: 0,
          task_count: 0,
          total_triggers: 0,
          latest_task_date: '2026-01-01T00:00:00Z',
          last_prompt: '',
          tasks: [],
          total_completed_tasks: 0,
          total_ongoing_tasks: 0,
          average_tokens_per_task: 0,
        },
      ];

      expect(flattenProjectTasks(projects)).toEqual([]);
    });
  });
});
