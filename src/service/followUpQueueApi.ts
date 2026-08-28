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
const PENDING_FOLLOW_UP_CACHE_MS = 3000;
const pendingFollowUpCache = new Map<
  string,
  { expiresAt: number; request: Promise<DurableFollowUpRequest[]> }
>();

function invalidatePendingFollowUps(projectId: string): void {
  pendingFollowUpCache.delete(projectId);
}

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
  review_handoff_ids: string[];
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

/**
 * Validate one durable follow-up record at the transport boundary.
 *
 * The list helpers below already guard their array shape. Without the same
 * guard on single-record reads, an empty or error-shaped body flows out under
 * a `DurableFollowUpRequest` annotation the runtime never checked, and the
 * failure surfaces much later as a property access on `undefined`.
 */
function parseFollowUpRecord(
  response: unknown,
  context: string
): DurableFollowUpRequest {
  const record = response as Partial<DurableFollowUpRequest> | null;
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.request_id !== 'string' ||
    !record.request_id ||
    typeof record.content !== 'string'
  ) {
    throw new Error(`${context} returned an invalid follow-up record`);
  }
  return {
    ...(record as DurableFollowUpRequest),
    attachment_paths: Array.isArray(record.attachment_paths)
      ? record.attachment_paths
      : [],
    review_handoff_ids: Array.isArray(record.review_handoff_ids)
      ? record.review_handoff_ids
      : [],
  };
}

export async function createFollowUpRequest(input: {
  projectId: string;
  requestId: string;
  content: string;
  attachmentPaths: string[];
  reviewHandoffIds?: string[];
  source?: 'local' | 'remote_control' | 'scheduled';
  sourceCommandId?: string;
}): Promise<DurableFollowUpRequest> {
  invalidatePendingFollowUps(input.projectId);
  const response = await fetchPost(basePath(input.projectId), {
    request_id: input.requestId,
    content: input.content,
    attachment_paths: input.attachmentPaths,
    ...(input.reviewHandoffIds?.length
      ? { review_handoff_ids: input.reviewHandoffIds }
      : {}),
    delivery_mode: 'wait',
    source: input.source || 'local',
    source_command_id: input.sourceCommandId,
  });
  return parseFollowUpRecord(response, 'createFollowUpRequest');
}

export async function listPendingRemoteFollowUpRequests(): Promise<
  DurableFollowUpRequest[]
> {
  const response = await fetchGet('/follow-ups/pending', {
    source: 'remote_control',
  });
  return Array.isArray(response?.items) ? response.items : [];
}

export async function getRemoteFollowUpByCommandId(
  sourceCommandId: string
): Promise<DurableFollowUpRequest> {
  const response = await fetchGet(
    `/follow-ups/source-command/${encodeURIComponent(sourceCommandId)}`
  );
  return parseFollowUpRecord(response, 'getRemoteFollowUpByCommandId');
}

export async function listPendingFollowUpRequests(
  projectId: string
): Promise<DurableFollowUpRequest[]> {
  const cached = pendingFollowUpCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = fetchGet(basePath(projectId)).then((response) =>
    Array.isArray(response?.items) ? response.items : []
  );
  pendingFollowUpCache.set(projectId, {
    expiresAt: Date.now() + PENDING_FOLLOW_UP_CACHE_MS,
    request,
  });
  request.catch(() => {
    if (pendingFollowUpCache.get(projectId)?.request === request) {
      pendingFollowUpCache.delete(projectId);
    }
  });
  return request;
}

export async function prioritizeFollowUpRequest(
  projectId: string,
  requestId: string
): Promise<DurableFollowUpRequest> {
  invalidatePendingFollowUps(projectId);
  const response = await fetchPost(
    `${basePath(projectId)}/${encodeURIComponent(requestId)}/send-now`
  );
  return parseFollowUpRecord(response, 'prioritizeFollowUpRequest');
}

export async function cancelFollowUpRequest(
  projectId: string,
  requestId: string
): Promise<DurableFollowUpRequest> {
  invalidatePendingFollowUps(projectId);
  const response = await fetchDelete(
    `${basePath(projectId)}/${encodeURIComponent(requestId)}`
  );
  return parseFollowUpRecord(response, 'cancelFollowUpRequest');
}

export async function markFollowUpRequestAdmitted(
  projectId: string,
  requestId: string,
  runId: string
): Promise<DurableFollowUpRequest> {
  invalidatePendingFollowUps(projectId);
  const response = await fetchPost(
    `${basePath(projectId)}/${encodeURIComponent(requestId)}/admitted`,
    { run_id: runId }
  );
  return parseFollowUpRecord(response, 'markFollowUpRequestAdmitted');
}
