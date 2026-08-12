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

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';

const TERMINAL_CONTINUATION_ADMISSION_CODES = new Set([
  'continuation_resume_required',
  'continuation_outcome_unknown',
  'continuation_clarification_required',
  'continuation_duplicate_without_progress',
]);

export interface ContinuationAdmissionRejection {
  code: string;
  message: string;
  interaction_type: 'continuation_clarification';
  project_state_version?: number;
}

export function terminalContinuationAdmissionRejection(
  error: unknown
): ContinuationAdmissionRejection | null {
  const detail = (error as any)?.response?.data?.detail;
  if (
    !detail ||
    typeof detail !== 'object' ||
    detail.interaction_type !== 'continuation_clarification' ||
    !TERMINAL_CONTINUATION_ADMISSION_CODES.has(String(detail.code))
  ) {
    return null;
  }
  return {
    code: String(detail.code),
    message: String(detail.message || detail.code),
    interaction_type: 'continuation_clarification',
    project_state_version:
      typeof detail.project_state_version === 'number'
        ? detail.project_state_version
        : undefined,
  };
}

export interface DurableFollowUpRequest {
  request_id: string;
  project_id: string;
  content: string;
  attachment_paths: string[];
  delivery_mode: 'wait' | 'send_now';
  status: 'pending' | 'admitted' | 'cancelled';
  admitted_run_id?: string | null;
  source: 'local' | 'remote_control' | 'scheduled';
  source_command_id?: string | null;
  last_error?: string | null;
  created_at: number;
  updated_at: number;
}

function basePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/follow-ups`;
}

export function createFollowUpRequest(input: {
  projectId: string;
  requestId: string;
  content: string;
  attachmentPaths: string[];
  source?: 'local' | 'remote_control' | 'scheduled';
  sourceCommandId?: string;
}): Promise<DurableFollowUpRequest> {
  return fetchPost(basePath(input.projectId), {
    request_id: input.requestId,
    content: input.content,
    attachment_paths: input.attachmentPaths,
    delivery_mode: 'wait',
    source: input.source || 'local',
    source_command_id: input.sourceCommandId,
  });
}

export async function listPendingRemoteFollowUpRequests(): Promise<
  DurableFollowUpRequest[]
> {
  const response = await fetchGet('/follow-ups/pending', {
    source: 'remote_control',
  });
  return Array.isArray(response?.items) ? response.items : [];
}

export function getRemoteFollowUpByCommandId(
  sourceCommandId: string
): Promise<DurableFollowUpRequest> {
  return fetchGet(
    `/follow-ups/source-command/${encodeURIComponent(sourceCommandId)}`
  );
}

export async function listPendingFollowUpRequests(
  projectId: string
): Promise<DurableFollowUpRequest[]> {
  const response = await fetchGet(basePath(projectId));
  return Array.isArray(response?.items) ? response.items : [];
}

export function prioritizeFollowUpRequest(
  projectId: string,
  requestId: string
): Promise<DurableFollowUpRequest> {
  return fetchPost(
    `${basePath(projectId)}/${encodeURIComponent(requestId)}/send-now`
  );
}

export function cancelFollowUpRequest(
  projectId: string,
  requestId: string
): Promise<DurableFollowUpRequest> {
  return fetchDelete(`${basePath(projectId)}/${encodeURIComponent(requestId)}`);
}

export function markFollowUpRequestAdmitted(
  projectId: string,
  requestId: string,
  runId: string
): Promise<DurableFollowUpRequest> {
  return fetchPost(
    `${basePath(projectId)}/${encodeURIComponent(requestId)}/admitted`,
    { run_id: runId }
  );
}
