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

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  archiveMemoryEntry,
  confirmMemoryEntry,
  consolidateMemoryScope,
  createMemoryEntry,
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
  Archive,
  ArchiveRestore,
  Brain,
  Check,
  Ellipsis,
  Lightbulb,
  ListChevronsDownUp,
  ListChevronsUpDown,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Share2,
  Sparkles,
  Star,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';
import SettingsSectionPage from '../SettingsSectionPage';
import { MemoryScopeDirectory } from './MemoryScopeNotice';

const KINDS: MemoryKind[] = [
  'fact',
  'decision',
  'constraint',
  'preference',
  'todo',
  'lesson',
];

const TRUST_LABELS: Record<
  MemoryEntry['source_trust'],
  { key: string; defaultValue: string }
> = {
  user_confirmed: {
    key: 'setting.memory-trust-user-confirmed',
    defaultValue: 'Confirmed by you',
  },
  user_asserted: {
    key: 'setting.memory-trust-user-asserted',
    defaultValue: 'From your message',
  },
  system_verified: {
    key: 'setting.memory-trust-system-verified',
    defaultValue: 'Eigent system record',
  },
  tool_observed: {
    key: 'setting.memory-trust-tool-observed',
    defaultValue: 'Observed by a tool',
  },
  external_untrusted: {
    key: 'setting.memory-trust-external-untrusted',
    defaultValue: 'External, untrusted source',
  },
  model_inferred: {
    key: 'setting.memory-trust-model-inferred',
    defaultValue: 'Agent inference',
  },
  legacy_unverified: {
    key: 'setting.memory-trust-legacy-unverified',
    defaultValue: 'Imported, unverified',
  },
};

interface MemoryProps {
  fixedScope?: {
    type: MemoryScopeType;
    id: string;
  };
  fixedScopeLabel?: string;
  homeOverview?: boolean;
  showScopeSelector?: boolean;
}

export default function Memory({
  fixedScope,
  fixedScopeLabel,
  homeOverview = false,
  showScopeSelector = true,
}: MemoryProps = {}) {
  const { t } = useTranslation();
  const memoryKindLabel = (kind: MemoryKind) =>
    t(`setting.memory-kind-${kind}`, {
      defaultValue: kind[0].toUpperCase() + kind.slice(1),
    });
  const trustLabel = useCallback(
    (trust: MemoryEntry['source_trust']) => {
      const label = TRUST_LABELS[trust] ?? TRUST_LABELS.legacy_unverified;
      return t(label.key, { defaultValue: label.defaultValue });
    },
    [t]
  );
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const userId = useAuthStore((state) => state.user_id);
  const [scopeType, setScopeType] = useState<MemoryScopeType>(
    fixedScope?.type ?? 'user'
  );
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
  const [sortBy, setSortBy] = useState<'added-time' | 'type'>('added-time');
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
  const showScopeDirectory =
    homeOverview && !fixedScope && scopeType !== 'user';
  const scopeId = showScopeDirectory
    ? null
    : (fixedScope?.id ?? scopeIds[scopeType]);

  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!scopeId) {
      setEntries([]);
      setReconciliationItems([]);
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
    const previousState = scopeState;
    const selectedScopeType = scopeType;
    const selectedScopeId = scopeId;

    setError('');
    setScopeState({
      ...scopeState,
      capture_enabled: patch.captureEnabled ?? scopeState.capture_enabled,
      use_enabled: patch.useEnabled ?? scopeState.use_enabled,
    });

    void updateMemoryScopeSettings(scopeType, scopeId, {
      expectedRevision: scopeState.revision,
      ...patch,
    })
      .then((updatedState) => {
        setScopeState((currentState) =>
          currentState?.scope_type === selectedScopeType &&
          currentState.scope_id === selectedScopeId
            ? updatedState
            : currentState
        );
      })
      .catch((caught) => {
        setScopeState((currentState) =>
          currentState?.scope_type === selectedScopeType &&
          currentState.scope_id === selectedScopeId
            ? previousState
            : currentState
        );
        setError(caught instanceof Error ? caught.message : String(caught));
      });
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
    const filtered = needle
      ? entries.filter(
          (entry) =>
            entry.content.toLocaleLowerCase().includes(needle) ||
            entry.kind.includes(needle) ||
            trustLabel(entry.source_trust).toLocaleLowerCase().includes(needle)
        )
      : entries;

    return [...filtered].sort((left, right) => {
      if (left.pinned_by_user !== right.pinned_by_user) {
        return left.pinned_by_user ? -1 : 1;
      }
      if (sortBy === 'type') {
        const kindOrder = left.kind.localeCompare(right.kind);
        if (kindOrder !== 0) return kindOrder;
      }
      return right.created_at - left.created_at;
    });
  }, [entries, search, sortBy, trustLabel]);

  const syncStatusLabel =
    syncStatus === 'synced'
      ? t('setting.memory-sync-synced', { defaultValue: 'Synced' })
      : syncStatus === 'pending'
        ? t('setting.memory-sync-pending', { defaultValue: 'Pending' })
        : syncStatus === 'blocked'
          ? t('setting.memory-sync-needs-attention', {
              defaultValue: 'Needs attention',
            })
          : t('setting.memory-sync-unavailable', {
              defaultValue: 'Unavailable',
            });
  const initialLoading = loading && !scopeState;
  const activeEntryCount = entries.filter((entry) => !entry.deleted_at).length;
  const scopePresentation =
    scopeType === 'space'
      ? {
          icon: Share2,
          capacityLabel: t('setting.memory-scope-shared', {
            defaultValue: 'shared',
          }),
          eyebrow: t('setting.memory-space-eyebrow', {
            defaultValue: 'Shared scope',
          }),
          title: t('setting.memory-space-title', {
            defaultValue: 'Shared across this Space',
          }),
          description: t('setting.memory-space-description', {
            defaultValue:
              'Eigent can learn stable notes explicitly meant for this Space and reuse them across its Sessions. Session-specific notes remain in their Session.',
          }),
          autoDescription: t('setting.memory-space-auto-description', {
            defaultValue:
              'Automatically learn explicit Space-wide facts, decisions, and preferences from Sessions in this Space. You can edit or archive them here at any time.',
          }),
          useTitle: t('setting.memory-space-use-title', {
            defaultValue: 'Use Space Memory',
          }),
          useDescription: t('setting.memory-space-use-description', {
            defaultValue:
              'Include these shared notes in future Agent context for Sessions in this Space.',
          }),
          collectionTitle: t('setting.memory-space-collection-title', {
            defaultValue: 'Shared Space Memory',
          }),
          collectionDescription: t(
            'setting.memory-space-collection-description',
            {
              defaultValue:
                'Only notes saved here are shared. Session Memory remains inside its Session.',
            }
          ),
          composerPlaceholder: t('setting.memory-space-composer-placeholder', {
            defaultValue:
              'Add a decision, constraint, preference, or fact to share across this Space',
          }),
          emptyTitle: t('setting.memory-space-empty-title', {
            defaultValue: 'No shared Memory yet',
          }),
          emptyDescription: t('setting.memory-space-empty-description', {
            defaultValue:
              'Add a stable note above when you want every Session in this Space to remember it.',
          }),
        }
      : scopeType === 'project'
        ? {
            icon: Sparkles,
            capacityLabel: t('setting.memory-scope-session', {
              defaultValue: 'session',
            }),
            eyebrow: t('setting.memory-session-eyebrow', {
              defaultValue: 'Session-specific',
            }),
            title: t('setting.memory-session-title', {
              defaultValue: 'Remembered for this Session',
            }),
            description: t('setting.memory-session-description', {
              defaultValue:
                'Eigent can learn a small set of stable notes from this Session. These notes stay with the Session and are separate from its full task history.',
            }),
            autoDescription: t('setting.memory-session-auto-description', {
              defaultValue:
                'Automatically learn explicit stable details as this Session runs. You can edit or archive them here at any time.',
            }),
            useTitle: t('setting.memory-session-use-title', {
              defaultValue: 'Use Session Memory',
            }),
            useDescription: t('setting.memory-session-use-description', {
              defaultValue:
                'Include these notes in future Agent context for this Session.',
            }),
            collectionTitle: fixedScopeLabel
              ? t('setting.memory-session-saved-title', {
                  defaultValue: 'Saved Session Memory',
                })
              : t('setting.memory-session-collection-title', {
                  defaultValue: 'Session Memory',
                }),
            collectionDescription: t(
              'setting.memory-session-collection-description',
              {
                defaultValue:
                  'Review, confirm, and manage the stable notes saved for this Session.',
              }
            ),
            composerPlaceholder: t(
              'setting.memory-session-composer-placeholder',
              {
                defaultValue:
                  'Add a decision, constraint, preference, or fact for this Session',
              }
            ),
            emptyTitle: t('setting.memory-session-empty-title', {
              defaultValue: 'No Session Memory yet',
            }),
            emptyDescription: t('setting.memory-session-empty-description', {
              defaultValue:
                'Add a note above, or turn on Auto Memory so Eigent can learn stable details as this Session runs.',
            }),
          }
        : {
            icon: Brain,
            capacityLabel: t('setting.memory-scope-personal', {
              defaultValue: 'personal',
            }),
            eyebrow: t('setting.memory-personal-eyebrow', {
              defaultValue: 'Personal',
            }),
            title: t('setting.memory-personal-title', {
              defaultValue: 'Available across your account',
            }),
            description: t('setting.memory-personal-description', {
              defaultValue:
                'Eigent can learn personal preferences and stable facts you explicitly want reused across your work. Task history remains separate.',
            }),
            autoDescription: t('setting.memory-personal-auto-description', {
              defaultValue:
                'Automatically learn explicit account-wide preferences and facts from your Sessions. You can edit or archive them here at any time.',
            }),
            useTitle: t('setting.memory-personal-use-title', {
              defaultValue: 'Use Personal Memory',
            }),
            useDescription: t('setting.memory-personal-use-description', {
              defaultValue:
                'Include these personal notes in future Agent context.',
            }),
            collectionTitle: t('setting.memory-personal-collection-title', {
              defaultValue: 'Personal Memory',
            }),
            collectionDescription: t(
              'setting.memory-personal-collection-description',
              {
                defaultValue:
                  'Review and manage the stable notes saved for your account.',
              }
            ),
            composerPlaceholder: t(
              'setting.memory-personal-composer-placeholder',
              {
                defaultValue:
                  'Add a preference, constraint, or fact for Eigent to remember',
              }
            ),
            emptyTitle: t('setting.memory-personal-empty-title', {
              defaultValue: 'No Personal Memory yet',
            }),
            emptyDescription: t('setting.memory-personal-empty-description', {
              defaultValue:
                'Add a stable preference or fact above when you want Eigent to remember it across your work.',
            }),
          };
  const ScopeIcon = scopePresentation.icon;
  const showEntryControls =
    entries.length > 0 || search.trim().length > 0 || showArchived;
  const emptyStateCopy = search.trim()
    ? {
        title: t('setting.memory-no-matching-title', {
          defaultValue: 'No matching Memory',
        }),
        description: t('setting.memory-no-matching-description', {
          defaultValue: 'Try a different search or clear the current filters.',
        }),
      }
    : showArchived
      ? {
          title: t('setting.memory-no-archived-title', {
            defaultValue: 'No archived Memory',
          }),
          description: t('setting.memory-no-archived-description', {
            defaultValue: 'Archived notes will appear here when you have them.',
          }),
        }
      : {
          title: scopePresentation.emptyTitle,
          description: scopePresentation.emptyDescription,
        };

  return (
    <SettingsSectionPage>
      {showScopeSelector && !fixedScope ? (
        <SettingsRowGroup>
          <SettingsRow
            title={t('setting.memory-scope-title', {
              defaultValue: 'Memory scope',
            })}
            description={t('setting.memory-scope-description', {
              defaultValue:
                'Small, editable notes that Eigent may reuse. Canonical task history is stored separately for replay and reliability; it is not editable or exposed in Memory Center. Agents can always search that history when they need older details.',
            })}
            actionClassName="w-[280px]"
            action={
              <Tabs
                value={scopeType}
                onValueChange={(value) =>
                  setScopeType(value as MemoryScopeType)
                }
                className="w-full"
              >
                <TabsList
                  appearance="default"
                  aria-label={t('setting.memory-scope-title', {
                    defaultValue: 'Memory scope',
                  })}
                  className="w-full"
                >
                  {(['user', 'space', 'project'] as MemoryScopeType[]).map(
                    (value) => (
                      <TabsTrigger
                        key={value}
                        value={value}
                        className="flex-1 !text-ds-text-base"
                      >
                        {value === 'project'
                          ? t('layout.session', { defaultValue: 'Session' })
                          : value === 'space'
                            ? t('layout.space', { defaultValue: 'Space' })
                            : t('setting.memory-personal-scope', {
                                defaultValue: 'Personal',
                              })}
                      </TabsTrigger>
                    )
                  )}
                </TabsList>
              </Tabs>
            }
          />
        </SettingsRowGroup>
      ) : null}

      {showScopeDirectory ? (
        <MemoryScopeDirectory
          key={scopeType}
          scopeType={scopeType === 'space' ? 'space' : 'project'}
        />
      ) : !scopeId ? (
        <SettingsRowGroup>
          <SettingsRow
            title={t('setting.memory-saved-title', {
              defaultValue: 'Saved Memory',
            })}
            description={t('setting.memory-select-scope-description', {
              scope:
                scopeType === 'project'
                  ? t('layout.session', { defaultValue: 'Session' })
                  : scopeType === 'space'
                    ? t('layout.space', { defaultValue: 'Space' })
                    : t('setting.memory-personal-scope', {
                        defaultValue: 'Personal',
                      }),
              defaultValue: 'Select a {{scope}} to manage its Memory.',
            })}
          />
        </SettingsRowGroup>
      ) : (
        <>
          {fixedScopeLabel ? (
            <SettingsRowGroup>
              <SettingsRow
                title={t('layout.memory-editor-title', {
                  scopeName: fixedScopeLabel,
                })}
                description={t('layout.memory-editor-project-description')}
              />
            </SettingsRowGroup>
          ) : null}
          <div
            data-memory-scope-summary={scopeType}
            className="flex flex-col gap-3 rounded-2xl bg-ds-bg-information-subtle-default p-4 sm:flex-row sm:items-start"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ds-neutral-subtle-default text-ds-icon-information-default-default">
              <ScopeIcon className="h-5 w-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-ds-text-base font-semibold text-ds-ink-default-default">
                  {scopePresentation.title}
                </div>
                <span className="rounded-full bg-ds-neutral-subtle-default px-2 py-0.5 text-ds-text-meta font-medium text-ds-ink-muted-default">
                  {scopePresentation.eyebrow}
                </span>
              </div>
              <span className="mt-1 max-w-3xl text-ds-text-base text-ds-ink-muted-default">
                {scopePresentation.description}
              </span>
            </div>
          </div>
          {reconciliationItems.length > 0 && (
            <SettingsRowGroup>
              <SettingsRow
                title={t('setting.memory-reconciliation-title', {
                  defaultValue: 'Review Memory from another device',
                })}
                description={t('setting.memory-reconciliation-description', {
                  defaultValue:
                    'Eigent did not overwrite either version. Choose which content to keep for each item.',
                })}
              >
                <div className="flex flex-col gap-3 rounded-2xl bg-ds-bg-warning-subtle-default p-4">
                  {reconciliationItems.map((item) => (
                    <article
                      key={item.reconciliation_id}
                      className="rounded-xl bg-ds-neutral-default-default p-4"
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="text-xs font-semibold">
                            {t('setting.memory-this-device', {
                              defaultValue: 'This device',
                            })}
                          </div>
                          <p className="mt-1 text-ds-text-base whitespace-pre-wrap">
                            {String(item.local_entry.content ?? 'Archived')}
                          </p>
                        </div>
                        <div>
                          <div className="text-xs font-semibold">
                            {t('setting.memory-cloud-copy', {
                              defaultValue: 'Cloud copy',
                            })}
                          </div>
                          <p className="mt-1 text-ds-text-base whitespace-pre-wrap">
                            {item.cloud_entry.deleted_at
                              ? 'Archived'
                              : String(item.cloud_entry.content ?? '')}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          buttonRadius="full"
                          onClick={() =>
                            void runAndReload(() =>
                              resolveMemoryReconciliation(
                                item.reconciliation_id,
                                'local'
                              )
                            )
                          }
                        >
                          {t('setting.memory-keep-this-device', {
                            defaultValue: 'Keep this device',
                          })}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          buttonRadius="full"
                          onClick={() =>
                            void runAndReload(() =>
                              resolveMemoryReconciliation(
                                item.reconciliation_id,
                                'cloud'
                              )
                            )
                          }
                        >
                          {t('setting.memory-use-cloud-copy', {
                            defaultValue: 'Use cloud copy',
                          })}
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </SettingsRow>
            </SettingsRowGroup>
          )}

          <SettingsRowGroup>
            <SettingsRow
              title={t('setting.memory-auto-title', {
                defaultValue: 'Auto Memory',
              })}
              description={scopePresentation.autoDescription}
              action={
                initialLoading ? (
                  <Skeleton
                    aria-label={t('setting.memory-auto-loading', {
                      defaultValue: 'Loading Auto Memory setting',
                    })}
                    className="h-6 w-11 rounded-full"
                  />
                ) : (
                  <Switch
                    aria-label={t('setting.memory-auto-title', {
                      defaultValue: 'Auto Memory',
                    })}
                    checked={scopeState?.capture_enabled ?? false}
                    onCheckedChange={(value) =>
                      updateSettings({ captureEnabled: value })
                    }
                  />
                )
              }
            />
            <SettingsRow
              title={scopePresentation.useTitle}
              description={scopePresentation.useDescription}
              action={
                initialLoading ? (
                  <Skeleton
                    aria-label={t('setting.memory-use-loading', {
                      defaultValue: 'Loading Use Memory setting',
                    })}
                    className="h-6 w-11 rounded-full"
                  />
                ) : (
                  <Switch
                    aria-label={scopePresentation.useTitle}
                    checked={scopeState?.use_enabled ?? false}
                    onCheckedChange={(value) =>
                      updateSettings({ useEnabled: value })
                    }
                  />
                )
              }
            />
            <SettingsRow
              title={t('setting.memory-sync-title', {
                defaultValue: 'Memory Sync',
              })}
              description={
                initialLoading ? (
                  <Skeleton className="h-3 w-52" />
                ) : syncStatus === 'synced' ? (
                  activeEntryCount === 0 ? (
                    t('setting.memory-sync-empty', {
                      defaultValue: 'Up to date — no saved notes to sync yet',
                    })
                  ) : (
                    t('setting.memory-sync-current', {
                      defaultValue: 'Up to date on your Eigent account',
                    })
                  )
                ) : syncStatus === 'pending' ? (
                  t('setting.memory-sync-waiting', {
                    defaultValue: 'Waiting to sync automatically',
                  })
                ) : syncStatus === 'blocked' ? (
                  t('setting.memory-sync-blocked', {
                    defaultValue: 'Sync needs attention; local Memory is safe',
                  })
                ) : (
                  t('setting.memory-sync-status-unavailable', {
                    defaultValue: 'Sync status is not available yet',
                  })
                )
              }
              action={
                initialLoading ? (
                  <Skeleton className="h-7 w-24 rounded-full" />
                ) : syncStatus === 'synced' ? (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1 rounded-full border border-x border-y border-solid border-ds-hairline-default-default px-3 py-1 text-ds-text-base font-medium text-ds-ink-muted-default"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden />{' '}
                    {t('setting.memory-sync-synced', {
                      defaultValue: 'Synced',
                    })}
                  </span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    buttonRadius="full"
                    onClick={() => void reload()}
                  >
                    {syncStatusLabel}
                  </Button>
                )
              }
            />
            <SettingsRow
              title={t('setting.memory-capacity-title', {
                defaultValue: 'Capacity',
              })}
              description={t('setting.memory-capacity-description', {
                scope: scopePresentation.capacityLabel,
                defaultValue: 'Space used by saved {{scope}} Memory.',
              })}
              actionClassName="w-[280px]"
              action={
                initialLoading ? (
                  <div className="w-full">
                    <Skeleton className="h-2 w-full rounded-full" />
                    <div className="mt-2 flex justify-between">
                      <Skeleton className="h-2.5 w-12" />
                      <Skeleton className="h-2.5 w-24" />
                    </div>
                  </div>
                ) : (
                  <div className="w-full">
                    <Progress
                      value={capacity}
                      aria-label={t('setting.memory-storage-used', {
                        defaultValue: 'Memory storage used',
                      })}
                      className="bg-ds-neutral-subtle-default"
                      indicatorClassName="bg-ds-accent-default-default"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs text-ds-ink-muted-default">
                      <span>
                        {t('setting.memory-capacity-percent-full', {
                          capacity,
                          defaultValue: '{{capacity}}% full',
                        })}
                      </span>
                      <span>
                        {scopeState?.current_token_count ?? 0} /{' '}
                        {t('setting.memory-capacity-token-count', {
                          current: scopeState?.current_token_count ?? 0,
                          count: scopeState?.token_limit ?? 0,
                          defaultValue: '{{current}} / {{count}} tokens',
                        })}
                      </span>
                    </div>
                  </div>
                )
              }
            />
            <SettingsRow
              title={t('setting.memory-organise-title', {
                defaultValue: 'Organise Memory',
              })}
              description={
                activeEntryCount < 2
                  ? t('setting.memory-organise-unavailable-description', {
                      defaultValue:
                        'Available when there are multiple saved notes to consolidate.',
                    })
                  : t('setting.memory-organise-description', {
                      defaultValue:
                        'Consolidate exact machine-created duplicates without changing task history.',
                    })
              }
              action={
                initialLoading ? (
                  <Skeleton className="h-7 w-24 rounded-full" />
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    buttonRadius="full"
                    disabled={loading || activeEntryCount < 2}
                    onClick={() =>
                      void runAndReload(() =>
                        consolidateMemoryScope(scopeType, scopeId)
                      )
                    }
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden />{' '}
                    {t('setting.memory-organise-action', {
                      defaultValue: 'Organise',
                    })}
                  </Button>
                )
              }
            />
          </SettingsRowGroup>

          <SettingsRowGroup>
            <SettingsRow
              title={
                <span className="flex items-center gap-2">
                  <span>{scopePresentation.collectionTitle}</span>
                  {!initialLoading ? (
                    <span className="rounded-full bg-ds-neutral-subtle-default px-2 py-0.5 text-ds-text-meta font-medium text-ds-ink-muted-default">
                      {activeEntryCount}
                    </span>
                  ) : null}
                </span>
              }
              description={scopePresentation.collectionDescription}
            >
              <div
                data-memory-composer
                className="overflow-hidden rounded-2xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default"
              >
                <Textarea
                  aria-label={t('setting.memory-new', {
                    defaultValue: 'New Memory',
                  })}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={scopePresentation.composerPlaceholder}
                  maxLength={8192}
                  className="min-h-24 resize-none rounded-none border-0 border-x-0 border-y-0 bg-transparent shadow-none focus-visible:ring-0"
                />
                <div className="flex items-center justify-end gap-2 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default p-2">
                  <Select
                    value={draftKind}
                    onValueChange={(value) => setDraftKind(value as MemoryKind)}
                  >
                    <SelectTrigger
                      aria-label={t('setting.memory-type', {
                        defaultValue: 'Memory type',
                      })}
                      size="sm"
                      variant="primary"
                      wrapperClassName="w-40"
                    >
                      <SelectValue>{memoryKindLabel(draftKind)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((kind) => (
                        <SelectItem
                          key={kind}
                          value={kind}
                          className="capitalize"
                        >
                          {memoryKindLabel(kind)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    buttonRadius="full"
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
                    <Plus aria-hidden />{' '}
                    {t('setting.add', { defaultValue: 'Add' })}
                  </Button>
                </div>
              </div>

              {showEntryControls ? (
                <div className="mt-4 flex items-center gap-2">
                  <Input
                    size="sm"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('setting.memory-search', {
                      defaultValue: 'Search Memory',
                    })}
                    aria-label={t('setting.memory-search', {
                      defaultValue: 'Search Memory',
                    })}
                    className="min-w-52 flex-1"
                  />
                  <Select
                    value={sortBy}
                    onValueChange={(value) =>
                      setSortBy(value as 'added-time' | 'type')
                    }
                  >
                    <SelectTrigger
                      aria-label={t('setting.memory-order', {
                        defaultValue: 'Order Memory',
                      })}
                      size="sm"
                      variant="secondary"
                      wrapperClassName="w-44"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="added-time">
                        {t('setting.memory-order-added-time', {
                          defaultValue: 'Added time',
                        })}
                      </SelectItem>
                      <SelectItem value="type">
                        {t('setting.memory-order-type', {
                          defaultValue: 'Type',
                        })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <TooltipSimple
                    content={
                      showArchived
                        ? t('setting.memory-hide-archived', {
                            defaultValue: 'Hide archived',
                          })
                        : t('setting.memory-show-archived', {
                            defaultValue: 'Show archived',
                          })
                    }
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      buttonContent="icon-only"
                      textWeight="bold"
                      buttonRadius="lg"
                      aria-label={
                        showArchived
                          ? t('setting.memory-hide-archived', {
                              defaultValue: 'Hide archived',
                            })
                          : t('setting.memory-show-archived', {
                              defaultValue: 'Show archived',
                            })
                      }
                      aria-pressed={showArchived}
                      className={
                        showArchived
                          ? 'bg-ds-neutral-strong-default'
                          : undefined
                      }
                      onClick={() => setShowArchived((current) => !current)}
                    >
                      {showArchived ? (
                        <ListChevronsDownUp aria-hidden />
                      ) : (
                        <ListChevronsUpDown aria-hidden />
                      )}
                    </Button>
                  </TooltipSimple>
                </div>
              ) : null}
              {error && (
                <div className="mt-4 text-ds-text-base text-ds-text-error-default-default">
                  {error}
                </div>
              )}
              {loading && !scopeState ? (
                <div
                  role="status"
                  aria-label={t('setting.memory-saved-loading', {
                    defaultValue: 'Loading saved Memory',
                  })}
                  className="mt-4 flex flex-col gap-3"
                >
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              ) : visibleEntries.length === 0 ? (
                <div className="mt-4 flex flex-col items-center rounded-2xl bg-ds-neutral-subtle-default px-6 py-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ds-neutral-default-default text-ds-ink-muted-default">
                    <Lightbulb className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="mt-3 text-ds-text-base font-semibold text-ds-ink-default-default">
                    {emptyStateCopy.title}
                  </div>
                  <p className="mt-1 text-ds-text-base text-ds-ink-muted-default">
                    {emptyStateCopy.description}
                  </p>
                  {!search.trim() && !showArchived ? (
                    <>
                      <p className="mt-3 text-ds-text-meta text-ds-ink-muted-default">
                        {t('setting.memory-history-not-stored', {
                          defaultValue:
                            'Full task history stays available to the Agent and is not stored here.',
                        })}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        buttonRadius="full"
                        className="mt-2"
                        onClick={() => setShowArchived(true)}
                      >
                        <Archive aria-hidden />{' '}
                        {t('setting.memory-view-archived', {
                          defaultValue: 'View archived',
                        })}
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {visibleEntries.map((entry) => (
                    <article
                      key={entry.memory_id}
                      className={`rounded-xl bg-ds-neutral-subtle-default p-3 ${entry.deleted_at ? 'opacity-70' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div
                          className="flex min-w-0 items-center gap-2 overflow-hidden text-xs whitespace-nowrap text-ds-ink-muted-default"
                          title={t('setting.memory-entry-source-title', {
                            trust: trustLabel(entry.source_trust),
                            creator: entry.created_by,
                            defaultValue: '{{trust}} · Created by {{creator}}',
                          })}
                        >
                          <span className="shrink-0 font-semibold text-ds-ink-default-default capitalize">
                            {memoryKindLabel(entry.kind)}
                          </span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0">
                            {entry.confirmed_by_user
                              ? t('setting.memory-confirmed-by-you', {
                                  defaultValue: 'Confirmed by you',
                                })
                              : t('setting.memory-unconfirmed', {
                                  defaultValue: 'Unconfirmed',
                                })}
                          </span>
                          <span aria-hidden>·</span>
                          <span className="truncate capitalize">
                            {t('setting.memory-source', {
                              source: entry.created_by,
                              defaultValue: 'Source: {{source}}',
                            })}
                          </span>
                          {entry.deleted_at ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="shrink-0">
                                {t('setting.memory-archived', {
                                  defaultValue: 'Archived',
                                })}
                              </span>
                            </>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          {!entry.deleted_at ? (
                            editingId === entry.memory_id ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="primary"
                                buttonRadius="lg"
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
                                <Save aria-hidden />{' '}
                                {t('setting.save', { defaultValue: 'Save' })}
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                buttonRadius="lg"
                                className="opacity-50 transition-opacity hover:opacity-100"
                                onClick={() => {
                                  setEditingId(entry.memory_id);
                                  setEditingText(entry.content);
                                }}
                              >
                                <Pencil aria-hidden />{' '}
                                {t('setting.edit', { defaultValue: 'Edit' })}
                              </Button>
                            )
                          ) : null}

                          {/* Starring is one-way: the backend `pin` mutation
                              has no un-pin transition, so a starred entry
                              shows the filled star as state, not a control. */}
                          {!entry.deleted_at ? (
                            entry.pinned_by_user ? (
                              <span
                                role="img"
                                aria-label={t('setting.memory-starred', {
                                  defaultValue: 'Starred Memory',
                                })}
                                className="box-border flex h-[28px] min-h-[28px] w-[28px] min-w-[28px] shrink-0 items-center justify-center text-ds-ink-default-default"
                              >
                                <Star
                                  aria-hidden
                                  className="h-4 w-4 fill-current"
                                />
                              </span>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                buttonContent="icon-only"
                                buttonRadius="lg"
                                aria-label={t('setting.memory-star', {
                                  defaultValue: 'Star Memory',
                                })}
                                onClick={() =>
                                  void runAndReload(() => pinMemoryEntry(entry))
                                }
                              >
                                <Star aria-hidden className="fill-none" />
                              </Button>
                            )
                          ) : null}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                buttonContent="icon-only"
                                buttonRadius="lg"
                                aria-label={t('setting.memory-more-actions', {
                                  defaultValue: 'More Memory actions',
                                })}
                              >
                                <Ellipsis aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {!entry.deleted_at && !entry.confirmed_by_user ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void runAndReload(() =>
                                      confirmMemoryEntry(entry)
                                    )
                                  }
                                >
                                  <Check aria-hidden />{' '}
                                  {t('setting.memory-confirm', {
                                    defaultValue: 'Confirm Memory',
                                  })}
                                </DropdownMenuItem>
                              ) : null}
                              {entry.deleted_at ? (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void runAndReload(() =>
                                      restoreMemoryEntry(entry)
                                    )
                                  }
                                >
                                  <ArchiveRestore aria-hidden />{' '}
                                  {t('setting.memory-restore', {
                                    defaultValue: 'Restore Memory',
                                  })}
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    void runAndReload(() =>
                                      archiveMemoryEntry(entry)
                                    )
                                  }
                                >
                                  <Archive aria-hidden />{' '}
                                  {t('setting.memory-archive', {
                                    defaultValue: 'Archive Memory',
                                  })}
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {editingId === entry.memory_id ? (
                        <Textarea
                          value={editingText}
                          onChange={(event) =>
                            setEditingText(event.target.value)
                          }
                          aria-label={t('setting.memory-edit', {
                            defaultValue: 'Edit Memory',
                          })}
                          className="mt-3 max-h-20 min-h-20 resize-none"
                        />
                      ) : (
                        <span
                          className="mt-3 line-clamp-4 block max-h-20 overflow-hidden text-ds-text-base break-words whitespace-pre-wrap"
                          title={entry.content}
                        >
                          {entry.content}
                        </span>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </SettingsRow>
          </SettingsRowGroup>
        </>
      )}
    </SettingsSectionPage>
  );
}
