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

import type { HistoryTask, ProjectGroup } from '@/types/history';
import type {
  BillingSummary,
  SessionSidePanelData,
  SessionSnapshot,
  SessionStatus,
  SessionTimelineItem,
  WebProject,
  WebSession,
} from '@web/types';

const INTERNAL_STEP_KEYS = new Set([
  'agent',
  'agent_name',
  'agent_id',
  'mcp',
  'mcpServers',
  'mcp_servers',
  'skill',
  'skills',
  'model_platform',
  'model_type',
  'api_key',
  'api_url',
  'installed_mcp',
  'execution_context',
  'tool_name',
  'provider',
  'worker',
  'workers',
  'remote_sub_agent_config',
  'browser_port',
  'cdp_browsers',
  'env_path',
]);

const INTERNAL_STEP_PATTERNS = [
  /^mcp_/i,
  /agent_/i,
  /skill_/i,
  /tool_/i,
  /model_/i,
];

function isInternalField(key: string): boolean {
  if (INTERNAL_STEP_KEYS.has(key)) return true;
  return INTERNAL_STEP_PATTERNS.some((pattern) => pattern.test(key));
}

function stripInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripInternalFields);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      if (isInternalField(key)) continue;
      result[key] = stripInternalFields(child);
    }
    return result;
  }
  return value;
}

export function mapSessionStatus(status: number): SessionStatus {
  if (status === 1) return 'ongoing';
  if (status === 2) return 'done';
  return 'unknown';
}

export function toWebSession(task: HistoryTask): WebSession {
  return {
    id: task.id,
    taskId: task.task_id,
    projectId: task.project_id,
    question: task.question,
    summary: task.summary,
    status: mapSessionStatus(task.status),
    tokens: task.tokens ?? 0,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

export function toWebProject(group: ProjectGroup): WebProject {
  return {
    projectId: group.project_id,
    name: group.project_name || `Project ${group.project_id.slice(0, 8)}`,
    sessionCount: group.task_count,
    totalTokens: group.total_tokens,
    latestActivity: group.latest_task_date,
    lastPrompt: group.last_prompt || '',
    ongoingCount: group.total_ongoing_tasks,
    completedCount: group.total_completed_tasks,
    sessions: (group.tasks ?? []).map(toWebSession),
  };
}

export function formatTimelineLabel(step: string, data: unknown): string {
  const normalized = step.replace(/_/g, ' ').trim();
  if (!normalized) return 'Progress update';
  if (normalized.toLowerCase().includes('error')) return 'Error';
  if (normalized.toLowerCase().includes('complete')) return 'Completed';
  if (normalized.toLowerCase().includes('message')) return 'Message';
  if (typeof data === 'object' && data && 'content' in (data as object)) {
    const content = (data as { content?: string }).content;
    if (typeof content === 'string' && content.trim()) {
      return content.slice(0, 120);
    }
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function toSessionTimeline(
  steps: {
    id: number;
    step: string;
    data: unknown;
    timestamp?: number | null;
  }[]
): SessionTimelineItem[] {
  return steps
    .filter((item) => !isInternalField(item.step))
    .map((item) => {
      const cleaned = stripInternalFields(item.data);
      let detail: string | undefined;
      if (typeof cleaned === 'string') {
        detail = cleaned;
      } else if (cleaned && typeof cleaned === 'object') {
        const content =
          (cleaned as { content?: string; text?: string }).content ??
          (cleaned as { text?: string }).text;
        if (typeof content === 'string') detail = content;
      }
      return {
        id: item.id,
        label: formatTimelineLabel(item.step, cleaned),
        timestamp: item.timestamp ?? undefined,
        detail: detail?.slice(0, 500),
      };
    });
}

export function toSessionSnapshots(
  snapshots: {
    id: number;
    image_url?: string;
    browser_url?: string;
    created_at?: string;
  }[]
): SessionSnapshot[] {
  return snapshots.map((snapshot) => ({
    id: snapshot.id,
    imageUrl: snapshot.image_url,
    browserUrl: snapshot.browser_url,
    createdAt: snapshot.created_at,
  }));
}

export function buildSessionSidePanel(params: {
  session: WebSession;
  steps?: {
    id: number;
    step: string;
    data: unknown;
    timestamp?: number | null;
  }[];
  snapshots?: {
    id: number;
    image_url?: string;
    browser_url?: string;
    created_at?: string;
  }[];
  resultFiles?: { filename: string; url: string; relativePath?: string }[];
}): SessionSidePanelData {
  const timeline = params.steps ? toSessionTimeline(params.steps) : [];
  const errorItem = timeline.find((item) =>
    item.label.toLowerCase().includes('error')
  );

  return {
    taskId: params.session.taskId,
    status: params.session.status,
    question: params.session.question,
    summary: params.session.summary,
    tokens: params.session.tokens,
    createdAt: params.session.createdAt,
    updatedAt: params.session.updatedAt,
    timeline,
    snapshots: params.snapshots ? toSessionSnapshots(params.snapshots) : [],
    resultFiles: params.resultFiles ?? [],
    errorMessage: errorItem?.detail,
  };
}

export function normalizeBillingSummary(
  data: Partial<BillingSummary> | null | undefined,
  fallbackEmail?: string
): BillingSummary {
  return {
    email: data?.email ?? fallbackEmail ?? '',
    subscription_mode: data?.subscription_mode ?? 'free',
    plan_name: data?.plan_name ?? 'Free',
    credits_total: data?.credits_total ?? 0,
    credits_daily: data?.credits_daily ?? 0,
    credits_monthly: data?.credits_monthly ?? 0,
    credits_permanent: data?.credits_permanent ?? 0,
  };
}

export { isInternalField, stripInternalFields };
