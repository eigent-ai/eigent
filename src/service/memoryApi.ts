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
// Licensed under the Apache License, Version 2.0 (the "License");

import { fetchDelete, fetchGet, fetchPatch, fetchPost } from '@/api/http';

export type MemoryScopeType = 'project' | 'space' | 'user';
export type MemoryKind =
  'fact' | 'decision' | 'constraint' | 'preference' | 'todo' | 'lesson';
export type MemorySyncScope = 'full_memory';

export interface MemoryScopeState {
  scope_type: MemoryScopeType;
  scope_id: string;
  owner_kind: 'desktop' | 'cloud';
  revision: number;
  capture_enabled: boolean;
  use_enabled: boolean;
  sync_scope: MemorySyncScope;
  token_limit: number;
  current_token_count: number;
  consolidate_threshold: number;
  processed_through_watermark: string | null;
  extractor_version: string;
  last_consolidated_at: number | null;
  last_error: string | null;
  updated_at: number;
}

export interface MemoryEntry {
  memory_id: string;
  scope_type: MemoryScopeType;
  scope_id: string;
  kind: MemoryKind;
  content: string;
  priority: 'normal' | 'high';
  version: number;
  token_count: number;
  pinned_by_user: boolean;
  confirmed_by_user: boolean;
  created_by: 'extractor' | 'agent' | 'user' | 'importer';
  source_trust:
    | 'user_confirmed'
    | 'user_asserted'
    | 'system_verified'
    | 'tool_observed'
    | 'external_untrusted'
    | 'model_inferred'
    | 'legacy_unverified';
  sensitivity: 'normal' | 'personal' | 'sensitive';
  source_refs: string[];
  deleted_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface MemoryListResponse {
  scope_state: MemoryScopeState;
  items: MemoryEntry[];
  sync_status?: {
    state: 'synced' | 'pending' | 'blocked';
    pending_count: number;
    blocked_count: number;
    last_error: string | null;
    last_synced_at: number | null;
  };
}

export interface MemoryScopeSummary {
  scope_type: MemoryScopeType;
  scope_id: string;
  entry_count: number;
  scope_state: MemoryScopeState;
}

export interface MemoryReconciliationItem {
  reconciliation_id: string;
  account_owner_id: string;
  scope_type: MemoryScopeType;
  scope_id: string;
  memory_id: string;
  local_entry: Partial<MemoryEntry>;
  cloud_entry: Partial<MemoryEntry>;
  status: 'pending' | 'accepted_local' | 'accepted_cloud' | 'dismissed';
  created_at: number;
  resolved_at: number | null;
}

const scopePath = (scopeType: MemoryScopeType, scopeId: string) =>
  `/memory/scopes/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}`;

export const listMemoryEntries = (
  scopeType: MemoryScopeType,
  scopeId: string,
  includeDeleted = false
): Promise<MemoryListResponse> =>
  fetchGet('/memory/entries', {
    scope_type: scopeType,
    scope_id: scopeId,
    include_deleted: includeDeleted,
  });

export const listMemoryScopeSummaries = (
  scopes: Array<{ scopeType: MemoryScopeType; scopeId: string }>
): Promise<{ items: MemoryScopeSummary[] }> =>
  fetchPost('/memory/scopes/summaries', {
    scopes: scopes.map((scope) => ({
      scope_type: scope.scopeType,
      scope_id: scope.scopeId,
    })),
  });

export const listMemoryReconciliation = (
  scopeType: MemoryScopeType,
  scopeId: string
): Promise<{ items: MemoryReconciliationItem[] }> =>
  fetchGet('/memory/reconciliation', {
    scope_type: scopeType,
    scope_id: scopeId,
  });

export const resolveMemoryReconciliation = (
  reconciliationId: string,
  decision: 'local' | 'cloud' | 'dismiss'
): Promise<MemoryReconciliationItem> =>
  fetchPost(
    `/memory/reconciliation/${encodeURIComponent(reconciliationId)}/resolve`,
    { decision }
  );

export const updateMemoryScopeSettings = (
  scopeType: MemoryScopeType,
  scopeId: string,
  input: {
    expectedRevision: number;
    captureEnabled?: boolean;
    useEnabled?: boolean;
  }
): Promise<MemoryScopeState> =>
  fetchPatch(`${scopePath(scopeType, scopeId)}/settings`, {
    expected_revision: input.expectedRevision,
    capture_enabled: input.captureEnabled,
    use_enabled: input.useEnabled,
  });

export const consolidateMemoryScope = (
  scopeType: MemoryScopeType,
  scopeId: string
) =>
  fetchPost(`${scopePath(scopeType, scopeId)}/consolidate`, {
    request_id: crypto.randomUUID(),
    reason: 'Organized in Memory Center',
  });

export const createMemoryEntry = (
  scopeType: MemoryScopeType,
  scopeId: string,
  input: { content: string; kind: MemoryKind; reason: string }
) =>
  fetchPost(
    `/memory/entries?scope_type=${encodeURIComponent(scopeType)}&scope_id=${encodeURIComponent(scopeId)}`,
    {
      request_id: crypto.randomUUID(),
      content: input.content,
      kind: input.kind,
      reason: input.reason,
    }
  );

export const updateMemoryEntry = (
  entry: MemoryEntry,
  input: { content: string; kind: MemoryKind; reason: string }
) =>
  fetchPatch(`/memory/entries/${encodeURIComponent(entry.memory_id)}`, {
    request_id: crypto.randomUUID(),
    expected_version: entry.version,
    content: input.content,
    kind: input.kind,
    priority: entry.priority,
    sensitivity: entry.sensitivity,
    source_refs: entry.source_refs,
    reason: input.reason,
  });

const transitionMemoryEntry = (
  entry: MemoryEntry,
  operation: 'delete' | 'restore' | 'confirm' | 'pin',
  reason: string
) => {
  const path = `/memory/entries/${encodeURIComponent(entry.memory_id)}`;
  const body = {
    request_id: crypto.randomUUID(),
    expected_version: entry.version,
    reason,
  };
  if (operation === 'delete') return fetchDelete(path, body);
  return fetchPost(`${path}/${operation}`, body);
};

export const archiveMemoryEntry = (entry: MemoryEntry) =>
  transitionMemoryEntry(entry, 'delete', 'Archived in Memory Center');
export const restoreMemoryEntry = (entry: MemoryEntry) =>
  transitionMemoryEntry(entry, 'restore', 'Restored in Memory Center');
export const confirmMemoryEntry = (entry: MemoryEntry) =>
  transitionMemoryEntry(entry, 'confirm', 'Confirmed in Memory Center');
/** The `pin` mutation only sets the flag; there is no un-pin transition yet. */
export const pinMemoryEntry = (entry: MemoryEntry) =>
  transitionMemoryEntry(entry, 'pin', 'Pinned in Memory Center');
