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

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  confirmMemoryEntry,
  consolidateMemoryScope,
  createMemoryEntry,
  deleteMemoryEntry,
  listMemoryEntries,
  listMemoryReconciliation,
  pinMemoryEntry,
  resolveMemoryReconciliation,
  restoreMemoryEntry,
  updateMemoryEntry,
  updateMemoryScopeSettings,
  type MemoryEntry,
  type MemoryKind,
  type MemoryReconciliationItem,
  type MemoryScopeState,
  type MemoryScopeType,
} from '@/service/memoryApi';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ArchiveRestore,
  Brain,
  Check,
  Pin,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const KINDS: MemoryKind[] = [
  'fact',
  'decision',
  'constraint',
  'preference',
  'todo',
  'lesson',
];

const TRUST_LABELS: Record<MemoryEntry['source_trust'], string> = {
  user_confirmed: 'Confirmed by you',
  user_asserted: 'From your message',
  system_verified: 'Eigent system record',
  tool_observed: 'Observed by a tool',
  external_untrusted: 'External, untrusted source',
  model_inferred: 'Agent inference',
  legacy_unverified: 'Imported, unverified',
};

export default function Memory() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const userId = useAuthStore((state) => state.user_id);
  const [scopeType, setScopeType] = useState<MemoryScopeType>('project');
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [reconciliationItems, setReconciliationItems] = useState<
    MemoryReconciliationItem[]
  >([]);
  const [scopeState, setScopeState] = useState<MemoryScopeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [draftKind, setDraftKind] = useState<MemoryKind>('fact');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [syncStatus, setSyncStatus] = useState<
    'synced' | 'pending' | 'blocked' | 'unknown'
  >('unknown');
  const requestGeneration = useRef(0);

  const scopeIds = useMemo(
    () => ({
      project: activeProjectId,
      space: activeSpaceId,
      user: userId == null ? null : String(userId),
    }),
    [activeProjectId, activeSpaceId, userId]
  );
  const scopeId = scopeIds[scopeType];

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!scopeId) {
      setEntries([]);
      setScopeState(null);
      setSyncStatus('unknown');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await listMemoryEntries(
        scopeType,
        scopeId,
        showArchived
      );
      if (generation !== requestGeneration.current) return;
      setEntries(response.items);
      setScopeState(response.scope_state);
      setSyncStatus(response.sync_status?.state ?? 'unknown');
      try {
        const reconciliation = await listMemoryReconciliation(
          scopeType,
          scopeId
        );
        if (generation !== requestGeneration.current) return;
        setReconciliationItems(reconciliation.items);
      } catch {
        if (generation !== requestGeneration.current) return;
        setReconciliationItems([]);
      }
    } catch (caught) {
      if (generation !== requestGeneration.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [scopeId, scopeType, showArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runAndReload = async (operation: () => Promise<unknown>) => {
    setError('');
    try {
      await operation();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const updateSettings = (patch: {
    captureEnabled?: boolean;
    useEnabled?: boolean;
  }) => {
    if (!scopeId || !scopeState) return;
    void runAndReload(() =>
      updateMemoryScopeSettings(scopeType, scopeId, {
        expectedRevision: scopeState.revision,
        ...patch,
      })
    );
  };

  const capacity = scopeState
    ? Math.min(
        100,
        Math.round(
          (scopeState.current_token_count / scopeState.token_limit) * 100
        )
      )
    : 0;
  const visibleEntries = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter(
      (entry) =>
        entry.content.toLocaleLowerCase().includes(needle) ||
        entry.kind.includes(needle) ||
        TRUST_LABELS[entry.source_trust].toLocaleLowerCase().includes(needle)
    );
  }, [entries, search]);

  return (
    <div className="flex w-full flex-1 flex-col gap-5 px-6 pb-12 pt-8">
      <div>
        <div className="flex items-center gap-2 text-heading-sm font-bold">
          <Brain className="h-5 w-5" /> Memory
        </div>
        <p className="mt-2 max-w-3xl text-body-sm text-ds-text-neutral-muted-default">
          Small, editable notes that Eigent may reuse. Canonical task history is
          stored separately for replay and reliability; it is not editable or
          exposed in Memory Center. Agents can always search that history when
          they need older details.
        </p>
      </div>

      <div className="flex gap-2">
        {(['project', 'space', 'user'] as MemoryScopeType[]).map((value) => (
          <Button
            key={value}
            variant={scopeType === value ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setScopeType(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>

      {!scopeId ? (
        <div className="rounded-2xl bg-ds-bg-neutral-default-default p-6 text-body-sm">
          Select a {scopeType} to manage its Memory.
        </div>
      ) : (
        <>
          {reconciliationItems.length > 0 && (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
              <strong className="text-body-sm">
                Review Memory from another device
              </strong>
              <p className="mt-1 text-xs text-ds-text-neutral-muted-default">
                Eigent did not overwrite either version. Choose which content to
                keep for each item.
              </p>
              <div className="mt-4 flex flex-col gap-3">
                {reconciliationItems.map((item) => (
                  <article
                    key={item.reconciliation_id}
                    className="bg-white rounded-xl p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-semibold">This device</div>
                        <p className="mt-1 whitespace-pre-wrap text-body-sm">
                          {String(item.local_entry.content ?? 'Archived')}
                        </p>
                      </div>
                      <div>
                        <div className="text-xs font-semibold">Cloud copy</div>
                        <p className="mt-1 whitespace-pre-wrap text-body-sm">
                          {item.cloud_entry.deleted_at
                            ? 'Archived'
                            : String(item.cloud_entry.content ?? '')}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() =>
                          void runAndReload(() =>
                            resolveMemoryReconciliation(
                              item.reconciliation_id,
                              'local'
                            )
                          )
                        }
                      >
                        Keep this device
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void runAndReload(() =>
                            resolveMemoryReconciliation(
                              item.reconciliation_id,
                              'cloud'
                            )
                          )
                        }
                      >
                        Use cloud copy
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <section className="rounded-2xl bg-ds-bg-neutral-default-default p-5">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex items-center justify-between gap-4">
                <span>
                  <strong className="block text-body-sm">Auto Memory</strong>
                  <span className="text-xs text-ds-text-neutral-muted-default">
                    Incrementally learn a few stable notes
                  </span>
                </span>
                <Switch
                  checked={scopeState?.capture_enabled ?? false}
                  disabled={scopeType !== 'project'}
                  onCheckedChange={(value) =>
                    updateSettings({ captureEnabled: value })
                  }
                />
              </label>
              <label className="flex items-center justify-between gap-4">
                <span>
                  <strong className="block text-body-sm">Use Memory</strong>
                  <span className="text-xs text-ds-text-neutral-muted-default">
                    Include notes in future Agent context
                  </span>
                </span>
                <Switch
                  checked={scopeState?.use_enabled ?? false}
                  onCheckedChange={(value) =>
                    updateSettings({ useEnabled: value })
                  }
                />
              </label>
              <div className="text-body-sm">
                <strong className="block">Memory Sync</strong>
                <span className="text-xs text-ds-text-neutral-muted-default">
                  {syncStatus === 'synced'
                    ? 'Synced to your Eigent account'
                    : syncStatus === 'pending'
                      ? 'Waiting to sync automatically'
                      : syncStatus === 'blocked'
                        ? 'Sync needs attention; local Memory is safe'
                        : 'Sync status is not available yet'}
                </span>
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs">
                <span>{capacity}% full</span>
                <span>
                  {scopeState?.current_token_count ?? 0} /{' '}
                  {scopeState?.token_limit ?? 0} tokens
                </span>
              </div>
              <Progress value={capacity} />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-ds-text-neutral-muted-default">
                  At 75%, Eigent safely consolidates exact machine-created
                  duplicates. History is never changed.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading}
                  onClick={() =>
                    void runAndReload(() =>
                      consolidateMemoryScope(scopeType, scopeId)
                    )
                  }
                >
                  <RefreshCw className="mr-1 h-4 w-4" /> Organize
                </Button>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-ds-bg-neutral-default-default p-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select
                value={draftKind}
                onValueChange={(value) => setDraftKind(value as MemoryKind)}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Add a short Memory note"
                maxLength={8192}
              />
              <Button
                disabled={!draft.trim()}
                onClick={() => {
                  if (!scopeId || !draft.trim()) return;
                  void runAndReload(() =>
                    createMemoryEntry(scopeType, scopeId, {
                      content: draft.trim(),
                      kind: draftKind,
                      reason: 'Created in Memory Center',
                    }).then(() => setDraft(''))
                  );
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> Add
              </Button>
              <label className="ml-auto flex items-center gap-2 text-xs text-ds-text-neutral-muted-default">
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                />
                Show archived
              </label>
            </div>
            <Input
              className="mb-3"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search Memory"
              aria-label="Search Memory"
            />
            {error && (
              <div className="mb-3 text-body-sm text-red-600">{error}</div>
            )}
            {loading && !scopeState ? (
              <div className="py-8 text-center text-body-sm">
                Loading Memory…
              </div>
            ) : visibleEntries.length === 0 ? (
              <div className="py-8 text-center text-body-sm text-ds-text-neutral-muted-default">
                No saved Memory for this {scopeType}. That is okay—History
                remains available to the Agent.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {visibleEntries.map((entry) => (
                  <article
                    key={entry.memory_id}
                    className={`rounded-xl border border-ds-border-neutral-default-default p-4 ${entry.deleted_at ? 'opacity-70' : ''}`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full bg-ds-bg-neutral-subtle-default px-2 py-1">
                        {entry.kind}
                      </span>
                      <span>{TRUST_LABELS[entry.source_trust]}</span>
                      {entry.confirmed_by_user && (
                        <span className="text-green-600">Confirmed</span>
                      )}
                      {entry.pinned_by_user && <span>📌 Pinned</span>}
                      {entry.deleted_at && <span>Archived</span>}
                    </div>
                    <details className="mb-2 text-xs text-ds-text-neutral-muted-default">
                      <summary>Source and provenance</summary>
                      <div className="mt-1">
                        Created by {entry.created_by}; trust:{' '}
                        {TRUST_LABELS[entry.source_trust]}
                      </div>
                      {entry.source_refs.length > 0 ? (
                        <div className="mt-1">
                          {entry.source_refs.length} durable source
                          {entry.source_refs.length === 1 ? '' : 's'} recorded
                        </div>
                      ) : null}
                    </details>
                    {editingId === entry.memory_id ? (
                      <Textarea
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value)}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-body-sm">
                        {entry.content}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {entry.deleted_at ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void runAndReload(() => restoreMemoryEntry(entry))
                          }
                        >
                          <ArchiveRestore className="mr-1 h-4 w-4" /> Restore
                        </Button>
                      ) : (
                        <>
                          {editingId === entry.memory_id ? (
                            <Button
                              size="sm"
                              disabled={!editingText.trim()}
                              onClick={() =>
                                void runAndReload(() =>
                                  updateMemoryEntry(entry, {
                                    content: editingText.trim(),
                                    kind: entry.kind,
                                    reason: 'Edited in Memory Center',
                                  }).then(() => setEditingId(null))
                                )
                              }
                            >
                              <Save className="mr-1 h-4 w-4" /> Save
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingId(entry.memory_id);
                                setEditingText(entry.content);
                              }}
                            >
                              Edit
                            </Button>
                          )}
                          {!entry.confirmed_by_user && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void runAndReload(() =>
                                  confirmMemoryEntry(entry)
                                )
                              }
                            >
                              <Check className="mr-1 h-4 w-4" /> Confirm
                            </Button>
                          )}
                          {!entry.pinned_by_user && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void runAndReload(() => pinMemoryEntry(entry))
                              }
                            >
                              <Pin className="mr-1 h-4 w-4" /> Pin
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void runAndReload(() => deleteMemoryEntry(entry))
                            }
                          >
                            <Trash2 className="mr-1 h-4 w-4" /> Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
