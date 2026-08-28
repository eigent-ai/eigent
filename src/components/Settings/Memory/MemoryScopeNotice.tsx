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

import SearchInput from '@/components/Dashboard/SearchInput';
import { memoryEditorSearch } from '@/components/Home/memoryRoute';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  listMemoryEntries,
  listMemoryScopeSummaries,
  type MemoryScopeSummary,
  type MemoryScopeType,
} from '@/service/memoryApi';
import {
  getVisibleProjectMetasForSpace,
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { ArrowRight, Brain, Folder, FolderKanban } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { SettingsRow, SettingsRowGroup } from '../SettingsRowGroup';

type DirectoryScopeType = Extract<MemoryScopeType, 'space' | 'project'>;

interface MemoryDirectoryItem {
  scopeId: string;
  spaceId: string;
  projectId?: string;
  name: string;
  parentName?: string;
  projectCount?: number;
  updatedAt: number;
}

const summaryKey = (scopeType: DirectoryScopeType, scopeId: string) =>
  `${scopeType}:${scopeId}`;

async function loadLegacyScopeSummaries(
  scopeType: DirectoryScopeType,
  scopeIds: string[]
): Promise<{ items: MemoryScopeSummary[] }> {
  const items: MemoryScopeSummary[] = [];
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(4, scopeIds.length) },
    async () => {
      while (nextIndex < scopeIds.length) {
        const scopeId = scopeIds[nextIndex];
        nextIndex += 1;
        const response = await listMemoryEntries(scopeType, scopeId);
        items.push({
          scope_type: scopeType,
          scope_id: scopeId,
          entry_count: response.items.length,
          scope_state: response.scope_state,
        });
      }
    }
  );
  await Promise.all(workers);
  return { items };
}

export function MemoryScopeDirectory({
  scopeType,
}: {
  scopeType: DirectoryScopeType;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const [summaries, setSummaries] = useState<
    Record<string, MemoryScopeSummary>
  >({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);

  const spaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status === 'active' &&
            !isUnconfiguredPlaceholderSpace(space, projectsBySpaceId)
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [projectsBySpaceId, spacesById]
  );

  const items = useMemo<MemoryDirectoryItem[]>(() => {
    if (scopeType === 'space') {
      return spaces.map((space) => ({
        scopeId: space.id,
        spaceId: space.id,
        name: space.name,
        projectCount: getVisibleProjectMetasForSpace(
          projectsBySpaceId,
          space.id
        ).length,
        updatedAt: space.updatedAt,
      }));
    }

    return spaces.flatMap((space) =>
      getVisibleProjectMetasForSpace(projectsBySpaceId, space.id).map(
        (project) => ({
          scopeId: project.id,
          spaceId: space.id,
          projectId: project.id,
          name: project.name,
          parentName: space.name,
          updatedAt: project.updatedAt,
        })
      )
    );
  }, [projectsBySpaceId, scopeType, spaces]);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (items.length === 0) {
      setSummaries({});
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    const requestedScopes = items.map((item) => ({
      scopeType,
      scopeId: item.scopeId,
    }));
    void listMemoryScopeSummaries(requestedScopes)
      .catch((caught) => {
        // Desktop frontend and Brain can restart independently during local
        // development and staged upgrades. Fall back only when an older Brain
        // does not expose the batch route yet.
        if ((caught as { status?: number }).status !== 404) throw caught;
        return loadLegacyScopeSummaries(
          scopeType,
          requestedScopes.map((scope) => scope.scopeId)
        );
      })
      .then((response) => {
        if (requestGeneration.current !== generation) return;
        setSummaries(
          Object.fromEntries(
            response.items.map((summary) => [
              summaryKey(scopeType, summary.scope_id),
              summary,
            ])
          )
        );
      })
      .catch((caught) => {
        if (requestGeneration.current !== generation) return;
        setSummaries({});
        setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (requestGeneration.current === generation) setLoading(false);
      });
  }, [items, scopeType]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items
      .filter(
        (item) =>
          !needle ||
          item.name.toLocaleLowerCase().includes(needle) ||
          item.parentName?.toLocaleLowerCase().includes(needle)
      )
      .sort((left, right) => {
        const leftCount =
          summaries[summaryKey(scopeType, left.scopeId)]?.entry_count ?? 0;
        const rightCount =
          summaries[summaryKey(scopeType, right.scopeId)]?.entry_count ?? 0;
        if (leftCount > 0 !== rightCount > 0) {
          return leftCount > 0 ? -1 : 1;
        }
        if (leftCount !== rightCount) return rightCount - leftCount;
        if (left.updatedAt !== right.updatedAt) {
          return right.updatedAt - left.updatedAt;
        }
        return left.name.localeCompare(right.name);
      });
  }, [items, scopeType, search, summaries]);

  const populatedCount = items.filter(
    (item) =>
      (summaries[summaryKey(scopeType, item.scopeId)]?.entry_count ?? 0) > 0
  ).length;
  const totalEntryCount = items.reduce(
    (total, item) =>
      total +
      (summaries[summaryKey(scopeType, item.scopeId)]?.entry_count ?? 0),
    0
  );
  const isSpace = scopeType === 'space';
  const scopeLabel = isSpace
    ? t('layout.space', { defaultValue: 'Space' })
    : t('layout.session', { defaultValue: 'Session' });

  return (
    <SettingsRowGroup data-memory-scope-directory={scopeType}>
      <SettingsRow
        title={t('setting.memory-directory-title', {
          scope: scopeLabel,
          defaultValue: '{{scope}} Memory',
        })}
        description={
          isSpace
            ? t('setting.memory-directory-space-description', {
                defaultValue:
                  'Shared notes for every Session in a Space. Select a Space to review or add them.',
              })
            : t('setting.memory-directory-session-description', {
                defaultValue:
                  'Session-specific notes learned or saved while work runs. Select a Session to manage them.',
              })
        }
      >
        {items.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {loading ? (
              <Skeleton className="h-5 w-56" />
            ) : (
              <div className="flex flex-wrap items-center gap-2 text-ds-text-base text-ds-ink-muted-default">
                <Badge
                  size="sm"
                  variant="secondary"
                  tone={populatedCount > 0 ? 'success' : 'neutral'}
                >
                  {t(
                    isSpace
                      ? 'setting.memory-directory-spaces-with-memory'
                      : 'setting.memory-directory-sessions-with-memory',
                    {
                      count: populatedCount,
                      defaultValue:
                        populatedCount === 1
                          ? `{{count}} ${scopeLabel} with Memory`
                          : `{{count}} ${scopeLabel}s with Memory`,
                      defaultValue_one: `{{count}} ${scopeLabel} with Memory`,
                      defaultValue_other: `{{count}} ${scopeLabel}s with Memory`,
                    }
                  )}
                </Badge>
                <span>
                  {t('setting.memory-directory-saved-notes-total', {
                    count: totalEntryCount,
                    defaultValue:
                      totalEntryCount === 1
                        ? '{{count}} saved note total'
                        : '{{count}} saved notes total',
                    defaultValue_one: '{{count}} saved note total',
                    defaultValue_other: '{{count}} saved notes total',
                  })}
                </span>
              </div>
            )}
            <div className="w-56 max-w-full">
              <SearchInput
                color="subtle-default"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={
                  isSpace
                    ? t('setting.memory-directory-search-spaces', {
                        defaultValue: 'Search Spaces',
                      })
                    : t('setting.memory-directory-search-sessions', {
                        defaultValue: 'Search Sessions',
                      })
                }
              />
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl bg-ds-bg-error-subtle-default p-3 text-ds-text-base text-ds-text-error-strong-default">
            {t('setting.memory-directory-load-failed', {
              defaultValue:
                'Memory locations could not be loaded. Your saved Memory is safe; retry by reopening this tab.',
            })}
          </div>
        ) : null}

        {loading ? (
          <div
            role="status"
            aria-label={t('setting.memory-directory-loading', {
              scope: scopeLabel,
              defaultValue: 'Loading {{scope}} Memory',
            })}
          >
            {Array.from({ length: Math.min(items.length, 5) }, (_, index) => (
              <Skeleton
                key={index}
                className="mb-2 h-[76px] w-full rounded-xl last:mb-0"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl bg-ds-neutral-subtle-default px-6 py-10 text-center">
            <Brain className="h-8 w-8 text-ds-ink-muted-default" aria-hidden />
            <div className="mt-3 text-ds-text-base font-semibold">
              {isSpace
                ? t('setting.memory-directory-none-available-spaces', {
                    defaultValue: 'No Spaces available',
                  })
                : t('setting.memory-directory-none-available-sessions', {
                    defaultValue: 'No Sessions available',
                  })}
            </div>
            <p className="mt-1 text-ds-text-base text-ds-ink-muted-default">
              {isSpace
                ? t('setting.memory-directory-create-space-first', {
                    defaultValue:
                      'Create a Space before adding shared Space Memory.',
                  })
                : t('setting.memory-directory-create-session-first', {
                    defaultValue:
                      'Create a Session before adding or learning Session Memory.',
                  })}
            </p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="rounded-xl bg-ds-neutral-subtle-default px-6 py-8 text-center text-ds-text-base text-ds-ink-muted-default">
            {t('setting.memory-directory-no-match', {
              scope: scopeLabel,
              search: search.trim(),
              defaultValue: 'No {{scope}} matches “{{search}}”.',
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visibleItems.map((item) => {
              const summary =
                summaries[summaryKey(scopeType, item.scopeId)] ?? null;
              const entryCount = summary?.entry_count ?? 0;
              const tokenCount = summary?.scope_state.current_token_count ?? 0;
              const tokenLimit = summary?.scope_state.token_limit ?? 0;
              const capacity = tokenLimit
                ? Math.min(100, Math.round((tokenCount / tokenLimit) * 100))
                : 0;
              const ItemIcon = isSpace ? Folder : FolderKanban;

              return (
                <article
                  key={item.scopeId}
                  className="grid items-center gap-3 rounded-xl border border-x border-y border-solid border-transparent bg-ds-neutral-subtle-default px-4 py-3 transition-colors hover:border-ds-hairline-default-default md:grid-cols-[minmax(0,1fr)_minmax(160px,240px)_auto]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-neutral-default-default text-ds-ink-muted-default">
                      <ItemIcon className="h-4 w-4" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="truncate text-ds-text-base font-semibold text-ds-ink-default-default">
                          {item.name}
                        </span>
                        <Badge
                          size="xs"
                          variant="secondary"
                          tone={entryCount > 0 ? 'success' : 'neutral'}
                        >
                          {entryCount > 0
                            ? t('setting.memory-note-count', {
                                count: entryCount,
                                defaultValue:
                                  entryCount === 1
                                    ? '{{count}} note'
                                    : '{{count}} notes',
                                defaultValue_one: '{{count}} note',
                                defaultValue_other: '{{count}} notes',
                              })
                            : t('setting.memory-empty', {
                                defaultValue: 'Empty',
                              })}
                        </Badge>
                      </div>
                      <div className="mt-0.5 truncate text-ds-text-base text-ds-ink-muted-default">
                        {isSpace
                          ? t('setting.memory-directory-session-count', {
                              count: item.projectCount ?? 0,
                              defaultValue:
                                (item.projectCount ?? 0) === 1
                                  ? '{{count}} Session'
                                  : '{{count}} Sessions',
                              defaultValue_one: '{{count}} Session',
                              defaultValue_other: '{{count}} Sessions',
                            })
                          : t('setting.memory-directory-parent-space', {
                              name: item.parentName,
                              defaultValue: 'Space: {{name}}',
                            })}
                      </div>
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2 text-ds-text-meta text-ds-ink-muted-default">
                      <span>
                        {t('setting.memory-capacity-percent-used', {
                          capacity,
                          defaultValue: '{{capacity}}% used',
                        })}
                      </span>
                      <span>
                        {t('setting.memory-capacity-token-count', {
                          count: tokenLimit,
                          current: tokenCount,
                          defaultValue: '{{current}} / {{count}} tokens',
                        })}
                      </span>
                    </div>
                    <Progress
                      value={capacity}
                      aria-label={t('setting.memory-capacity-label', {
                        name: item.name,
                        defaultValue: '{{name}} Memory capacity',
                      })}
                      className="mt-1 bg-ds-neutral-default-default"
                      indicatorClassName="bg-ds-accent-default-default"
                    />
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    variant={entryCount > 0 ? 'primary' : 'outline'}
                    buttonRadius="full"
                    aria-label={t('setting.memory-manage-for', {
                      name: item.name,
                      defaultValue: 'Manage Memory for {{name}}',
                    })}
                    onClick={() =>
                      navigate(
                        {
                          pathname: '/home',
                          search: memoryEditorSearch(
                            item.spaceId,
                            item.projectId
                          ),
                        },
                        { state: location.state }
                      )
                    }
                  >
                    {t('setting.manage', { defaultValue: 'Manage' })}{' '}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                </article>
              );
            })}
          </div>
        )}
      </SettingsRow>
    </SettingsRowGroup>
  );
}
