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
  fetchDelete,
  fetchGet,
  fetchGetBlob,
  fetchPost,
  proxyFetchPatch,
} from '@/api/http';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  captureDefaultModelSelection,
  type DefaultModelSelectionSnapshot,
} from '@/lib/defaultModelSelectionState';
import { getAuthStore } from '@/store/authStore';

export interface ExecutionScope {
  projectId: string;
  accountKey: string;
  signal?: AbortSignal;
}

export interface ManagedModelSelection {
  modelType: 'custom' | 'local';
  provider_id: number;
  model_platform?: string;
  model_type?: string;
}

export interface RegisteredExecutionConfiguration {
  project_id: string;
  configuration_revision: string;
  envelope: Record<string, unknown>;
}

export interface SessionExecutionRoute {
  project_id: string;
  route: 'legacy' | 'managed';
  entry_enabled: boolean;
  eligible: boolean;
  reason: string | null;
  profile: string | null;
  configuration: RegisteredExecutionConfiguration | null;
  selection?: ManagedModelSelection | null;
  has_requests: boolean;
  request_cursor: number;
}

export interface SessionExecutionRequest {
  request_id: string;
  project_id: string;
  kind: 'start' | 'follow_up';
  source: string;
  queue_seq: number;
  delivery_mode: 'wait' | 'send_now';
  status: 'pending' | 'preparing' | 'admitted' | 'cancelled';
  wait_reason: string | null;
  admitted_run_id: string | null;
  admitted_attempt_id: string | null;
  configuration_revision: string | null;
  run_status: string | null;
  settlement: string | null;
  cancel_requested: boolean;
  content: string;
  content_truncated: boolean;
  created_at: number;
  updated_at: number;
}

export interface ExecutionPage {
  project_id: string;
  items: SessionExecutionRequest[];
  next_cursor: number | null;
}

export interface ExecutionArtifact {
  artifact_id: string;
  filename: string;
  relativePath: string;
  size: number;
  content_digest: string;
  checkpoint_revision: string;
}

export class SessionExecutionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SessionExecutionError';
  }
}

export function executionScope(projectId: string): ExecutionScope {
  return { projectId, accountKey: getAccountEnvironmentKey(getAuthStore()) };
}

export function assertExecutionScope(scope: ExecutionScope): void {
  if (scope.accountKey !== getAccountEnvironmentKey(getAuthStore())) {
    throw new SessionExecutionError('account_changed');
  }
  if (scope.signal?.aborted)
    throw new DOMException('Session owner left', 'AbortError');
}

function options(scope: ExecutionScope) {
  assertExecutionScope(scope);
  return { expectedAccountKey: scope.accountKey, signal: scope.signal };
}

async function scoped<T>(scope: ExecutionScope, read: Promise<T>): Promise<T> {
  const result = await read;
  assertExecutionScope(scope);
  return result;
}

export async function fetchSessionExecutionRoute(
  scope: ExecutionScope
): Promise<SessionExecutionRoute> {
  const result = await scoped<SessionExecutionRoute>(
    scope,
    fetchGet(
      `/projects/${encodeURIComponent(scope.projectId)}/execution-route`,
      undefined,
      undefined,
      options(scope)
    )
  );
  if (
    result?.project_id !== scope.projectId ||
    !['legacy', 'managed'].includes(result.route)
  ) {
    throw new SessionExecutionError('invalid_response');
  }
  return result;
}

export async function requireLegacySession(
  scope: ExecutionScope
): Promise<void> {
  const route = await fetchSessionExecutionRoute(scope);
  if (route.route !== 'legacy')
    throw new SessionExecutionError('managed_execution_required');
}

export async function fetchSessionExecutions(
  scope: ExecutionScope,
  after = 0
): Promise<ExecutionPage> {
  const page = await scoped<ExecutionPage>(
    scope,
    fetchGet(
      `/projects/${encodeURIComponent(scope.projectId)}/executions`,
      { after, limit: 50 },
      undefined,
      options(scope)
    )
  );
  if (
    page?.project_id !== scope.projectId ||
    !Array.isArray(page.items) ||
    page.items.length > 50 ||
    page.items.some(
      (item) => item.project_id !== scope.projectId || item.queue_seq <= after
    ) ||
    (page.next_cursor !== null &&
      (!Number.isSafeInteger(page.next_cursor) || page.next_cursor <= after))
  ) {
    throw new SessionExecutionError('invalid_response');
  }
  return page;
}

export interface SessionMessageIntent {
  readonly scope: ExecutionScope;
  readonly requestId: string;
  readonly content: string;
  readonly kind: 'start' | 'follow_up';
  body?: Record<string, unknown>;
  deliveryAttempted: boolean;
  configuration?: SessionMessageConfiguration;
}

export interface SessionMessageConfiguration {
  spaceId: string;
  selection: ManagedModelSelection | null;
  thinkingEffort: string | null;
  defaultSelection?: DefaultModelSelectionSnapshot | null;
  waitForConfigurationWrites: () => Promise<void>;
}

export function createSessionMessageIntent(
  scope: ExecutionScope,
  content: string,
  kind: 'start' | 'follow_up'
): SessionMessageIntent {
  assertExecutionScope(scope);
  if (!content.trim() || content.length > 200_000)
    throw new SessionExecutionError('content_unsupported');
  return {
    scope: { ...scope },
    requestId: crypto.randomUUID(),
    content: content.trim(),
    kind,
    deliveryAttempted: false,
  };
}

export async function prepareSessionMessage(
  intent: SessionMessageIntent,
  input: SessionMessageConfiguration
): Promise<void> {
  if (intent.body) return; // Retrying never replaces an already pinned envelope.
  intent.configuration = Object.freeze({
    ...input,
    defaultSelection:
      input.defaultSelection === undefined && !input.selection
        ? captureDefaultModelSelection(intent.scope.accountKey)
        : input.defaultSelection,
    selection: input.selection ? Object.freeze({ ...input.selection }) : null,
  });
  input = intent.configuration;
  const { scope } = intent;
  assertExecutionScope(scope);
  if (input.defaultSelection && !(await input.defaultSelection.saved))
    throw new SessionExecutionError('configuration_changed');
  assertExecutionScope(scope);
  await input.waitForConfigurationWrites();
  assertExecutionScope(scope);
  const selection =
    input.selection ??
    input.defaultSelection?.selection ??
    (await fetchSessionExecutionRoute(scope)).selection;
  if (
    !selection ||
    !['custom', 'local'].includes(selection.modelType) ||
    !Number.isInteger(selection.provider_id)
  ) {
    throw new SessionExecutionError('model_unsupported');
  }
  const metadata = {
    modelSelection: { ...selection },
    thinkingEffort: input.thinkingEffort,
  };
  const saved = await scoped(
    scope,
    proxyFetchPatch(
      `/api/v1/spaces/${encodeURIComponent(input.spaceId)}/projects/${encodeURIComponent(scope.projectId)}`,
      { mode: 'single-agent', metadata },
      undefined,
      options(scope)
    )
  );
  if (
    saved?.id !== scope.projectId ||
    saved.space_id !== input.spaceId ||
    saved.mode !== 'single-agent' ||
    Object.entries(selection).some(
      ([key, value]) => saved.metadata?.modelSelection?.[key] !== value
    ) ||
    (saved.metadata?.thinkingEffort ?? null) !== input.thinkingEffort
  ) {
    throw new SessionExecutionError('configuration_changed');
  }
  const route = await fetchSessionExecutionRoute(scope);
  if (!route.entry_enabled || !route.eligible)
    throw new SessionExecutionError(route.reason || 'configuration_required');
  const registered = await scoped<RegisteredExecutionConfiguration>(
    scope,
    fetchPost(
      `/projects/${encodeURIComponent(scope.projectId)}/execution-configurations?claim_session=true`,
      {},
      undefined,
      options(scope)
    )
  );
  const envelope = registered?.envelope;
  if (
    registered?.project_id !== scope.projectId ||
    !envelope ||
    envelope.configuration_revision !== registered.configuration_revision ||
    envelope.space_id !== input.spaceId ||
    envelope.session_mode !== 'single-agent' ||
    typeof envelope.credential_ref !== 'string' ||
    !envelope.credential_ref.startsWith(`provider:${selection.provider_id}:`) ||
    (selection.model_platform &&
      envelope.model_platform !== selection.model_platform) ||
    (selection.model_type && envelope.model_type !== selection.model_type) ||
    (input.thinkingEffort && envelope.thinking_effort !== input.thinkingEffort)
  ) {
    throw new SessionExecutionError('configuration_changed');
  }
  intent.body = Object.freeze({
    request_id: intent.requestId,
    kind: intent.kind,
    envelope: Object.freeze({
      ...envelope,
      ...(intent.kind === 'start' ? { prompt: intent.content } : {}),
    }),
    ...(intent.kind === 'follow_up'
      ? {
          source_follow_up_request_id: intent.requestId,
          follow_up_content: intent.content,
        }
      : {}),
  });
}

export async function deliverSessionMessage(
  intent: SessionMessageIntent
): Promise<SessionExecutionRequest> {
  if (!intent.body) throw new SessionExecutionError('configuration_required');
  const { scope } = intent;
  if (intent.deliveryAttempted) {
    try {
      const existing = await scoped<SessionExecutionRequest>(
        scope,
        fetchGet(
          `/executions/${encodeURIComponent(intent.requestId)}`,
          undefined,
          undefined,
          options(scope)
        )
      );
      if (
        existing.project_id !== scope.projectId ||
        existing.kind !== intent.kind
      )
        throw new SessionExecutionError('invalid_response');
      return existing;
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }
  intent.deliveryAttempted = true;
  const result = await scoped<SessionExecutionRequest>(
    scope,
    fetchPost(
      `/projects/${encodeURIComponent(scope.projectId)}/executions`,
      intent.body,
      undefined,
      options(scope)
    )
  );
  if (
    result?.project_id !== scope.projectId ||
    result.request_id !== intent.requestId
  )
    throw new SessionExecutionError('invalid_response');
  return result;
}

export const cancelSessionExecution = (
  scope: ExecutionScope,
  requestId: string
) =>
  scoped(
    scope,
    fetchDelete(
      `/executions/${encodeURIComponent(requestId)}`,
      undefined,
      undefined,
      options(scope)
    )
  );

export const sendSessionExecutionNow = (
  scope: ExecutionScope,
  requestId: string,
  operationId: string
) =>
  scoped(
    scope,
    fetchPost(
      `/executions/${encodeURIComponent(requestId)}/delivery`,
      { delivery_mode: 'send_now', operation_id: operationId },
      undefined,
      options(scope)
    )
  );

export async function fetchExecutionArtifacts(
  scope: ExecutionScope,
  requestId: string
): Promise<{ artifacts: ExecutionArtifact[] }> {
  const result = await scoped(
    scope,
    fetchGet(
      `/executions/${encodeURIComponent(requestId)}/artifacts`,
      undefined,
      undefined,
      options(scope)
    )
  );
  if (
    result?.project_id !== scope.projectId ||
    result.run_id !== requestId ||
    !Array.isArray(result.artifacts) ||
    result.artifacts.some(
      (item: ExecutionArtifact) =>
        !item.artifact_id ||
        item.checkpoint_revision !== result.checkpoint_revision ||
        !item.content_digest
    )
  )
    throw new SessionExecutionError('invalid_response');
  return result;
}

export async function readExecutionArtifact(
  scope: ExecutionScope,
  requestId: string,
  artifactId: string
): Promise<Blob> {
  return scoped(
    scope,
    fetchGetBlob(
      `/executions/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
      { offset: 0, length: 1024 * 1024 },
      options(scope)
    )
  );
}
