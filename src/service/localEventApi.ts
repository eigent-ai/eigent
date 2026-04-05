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
 * Local event log API client.
 *
 * Reads from the local Python backend's SQLite event log endpoints.
 * These calls go to localhost (no cloud dependency) and are used by
 * the frontend's local-first data loading path.
 */

import { fetchGet } from '@/api/http';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export interface EventEnvelope {
  event_id: string;
  run_id: string;
  project_id: string;
  task_id: string | null;
  seq: number;
  event_type: string;
  occurred_at: string;
  source: string;
  agent_id: string | null;
  agent_name: string | null;
  schema_version: number;
  payload: Record<string, any>;
  synced_at: string | null;
  sync_attempts: number;
}

export interface RunSummary {
  run_id: string;
  project_id: string;
  task_id: string | null;
  event_count: number;
  first_event: string;
  last_event: string;
}

export interface ProjectSummary {
  project_id: string;
  run_count: number;
  event_count: number;
  first_event: string;
  last_event: string;
}

// -----------------------------------------------------------------------
// API calls (hit local backend at localhost:{backendPort})
// -----------------------------------------------------------------------

/**
 * Fetch events from the local event log.
 * At least one of runId, taskId, or projectId must be provided.
 */
export const fetchLocalEvents = async (params: {
  runId?: string;
  taskId?: string;
  projectId?: string;
  afterSeq?: number;
  limit?: number;
}): Promise<EventEnvelope[]> => {
  try {
    const queryParams: Record<string, any> = {};
    if (params.runId) queryParams.run_id = params.runId;
    if (params.taskId) queryParams.task_id = params.taskId;
    if (params.projectId) queryParams.project_id = params.projectId;
    if (params.afterSeq !== undefined) queryParams.after_seq = params.afterSeq;
    if (params.limit !== undefined) queryParams.limit = params.limit;

    const res = await fetchGet('/events', queryParams);
    return Array.isArray(res) ? res : [];
  } catch (error) {
    console.debug('[localEventApi] fetchLocalEvents failed:', error);
    return [];
  }
};

/**
 * List all runs from the local event log, optionally filtered by project.
 */
export const fetchLocalRuns = async (
  projectId?: string
): Promise<RunSummary[]> => {
  try {
    const params: Record<string, any> = {};
    if (projectId) params.project_id = projectId;

    const res = await fetchGet('/events/runs', params);
    return Array.isArray(res) ? res : [];
  } catch (error) {
    console.debug('[localEventApi] fetchLocalRuns failed:', error);
    return [];
  }
};

/**
 * List projects with aggregated stats from the local event log.
 */
export const fetchLocalProjects = async (): Promise<ProjectSummary[]> => {
  try {
    const res = await fetchGet('/events/projects');
    return Array.isArray(res) ? res : [];
  } catch (error) {
    console.debug('[localEventApi] fetchLocalProjects failed:', error);
    return [];
  }
};

/**
 * Check if local events exist for a given run/task.
 * Useful for deciding whether to load from local DB vs cloud.
 */
export const hasLocalEvents = async (params: {
  runId?: string;
  taskId?: string;
}): Promise<boolean> => {
  try {
    const events = await fetchLocalEvents({ ...params, limit: 1 });
    return events.length > 0;
  } catch {
    return false;
  }
};
