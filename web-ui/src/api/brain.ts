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
  fetchGet,
  fetchPut,
  sseTransport,
  uploadFileToBrain,
} from '@/api/http';
import { getAuthStore } from '@/store/authStore';
import type { TaskControlAction } from '@web/types';

function generateTaskId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sendProjectMessage(params: {
  projectId: string;
  question: string;
  taskId?: string;
  onEvent: (payload: unknown) => void;
  onDone?: () => void;
  signal?: AbortSignal;
}): string {
  const taskId = params.taskId ?? generateTaskId();
  const { token, email } = getAuthStore();

  void sseTransport({
    url: '/chat',
    method: 'POST',
    signal: params.signal,
    body: {
      project_id: params.projectId,
      task_id: taskId,
      question: params.question,
      email,
      api_key: token ?? '',
      api_url:
        import.meta.env.VITE_CLOUD_API_URL ?? 'https://proxy.eigent.ai/v1',
      model_platform: 'openai',
      model_type: 'gpt-5-mini',
      installed_mcp: { mcpServers: {} },
      language: 'en',
      allow_local_system: false,
      attaches: [],
      summary_prompt: '',
      new_agents: [],
    },
    onmessage(event) {
      try {
        params.onEvent(JSON.parse(event.data));
      } catch {
        params.onEvent({ raw: event.data });
      }
    },
    onclose() {
      params.onDone?.();
    },
  });

  return taskId;
}

export async function controlTask(
  taskId: string,
  action: TaskControlAction
): Promise<void> {
  await fetchPut(`/task/${taskId}/take-control`, { action });
}

export async function fetchProjectFiles(params: {
  projectId: string;
  taskId?: string;
}) {
  const { email } = getAuthStore();
  return fetchGet('/files', {
    project_id: params.projectId,
    email,
    ...(params.taskId ? { task_id: params.taskId } : {}),
  });
}

export { uploadFileToBrain };
