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
import ContentHeader from '@/components/Layout/ContentHeader';
import { TeachCommentInput } from '@/components/TeachMode/TeachCommentInput';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { Separator } from '@/components/ui/separator';
import { TooltipSimple } from '@/components/ui/tooltip';
import { isPlaceholderProjectName } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { getWorkspaceRelativeFilePath } from '@/lib/workspaceRelativePath';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { type SpaceProjectMeta, useSpaceStore } from '@/store/spaceStore';
import {
  type TeachFeedback,
  type TeachFeedbackSourceType,
  type TeachFileReference,
  useTeachModeStore,
} from '@/store/teachModeStore';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Plus,
  SquareDashedMousePointer,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AnnotationItem } from './annotation/AnnotationItem';

type FeedbackScope = 'session' | 'space';

function sessionDisplayName(
  session: SpaceProjectMeta | undefined,
  sessionId: string,
  fallback: string
) {
  if (!session) return fallback;
  if (
    session.name.trim().toLowerCase() !== 'project' &&
    !isPlaceholderProjectName(session.name, sessionId)
  )
    return session.name;
  const historyName = session.metadata?.historyDisplayName;
  return typeof historyName === 'string' && historyName.trim()
    ? historyName.trim()
    : fallback;
}

export function AnnotationTab() {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<FeedbackScope>('session');
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const initializedExpansion = useRef(false);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const sessionMetas = useSpaceStore((state) =>
    activeSpaceId ? state.projectsBySpaceId[activeSpaceId] : undefined
  );
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const feedbackById = useTeachModeStore((state) => state.feedbackById);
  const pendingAnnotation = useTeachModeStore(
    (state) => state.pendingAnnotation
  );
  const setPendingAnnotation = useTeachModeStore(
    (state) => state.setPendingAnnotation
  );
  const addAnnotation = useTeachModeStore((state) => state.addAnnotation);
  const updateAnnotation = useTeachModeStore((state) => state.updateAnnotation);
  const deleteAnnotation = useTeachModeStore((state) => state.deleteAnnotation);
  const [comment, setComment] = useState('');
  const [fileReferences, setFileReferences] = useState<TeachFileReference[]>(
    []
  );
  useEffect(() => {
    setComment('');
    setFileReferences([]);
  }, [pendingAnnotation]);
  const { entries, counts } = useMemo(() => {
    const spaceEntries = Object.values(feedbackById).filter(
      (entry) => entry.spaceId === activeSpaceId
    );
    const sessionEntries = spaceEntries.filter(
      (entry) => entry.projectId === projectId
    );
    return {
      entries: scope === 'space' ? spaceEntries : sessionEntries,
      counts: {
        session: sessionEntries.length,
        space: spaceEntries.length,
      },
    };
  }, [activeSpaceId, feedbackById, projectId, scope]);
  const fallbackSessionName = t('chat.teach-session', {
    defaultValue: 'Session',
  });

  const visibleEntries = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(i18n.language);
    if (!query) return entries;
    return entries.filter((entry) =>
      [
        entry.contextLabel,
        entry.contextDetail,
        sessionDisplayName(
          sessionMetas?.[entry.projectId],
          entry.projectId,
          fallbackSessionName
        ),
        entry.comment,
        entry.selectedText,
        ...(entry.fileReferences ?? []).map((file) => file.relativePath),
      ]
        .filter(Boolean)
        .some((value) =>
          value?.toLocaleLowerCase(i18n.language).includes(query)
        )
    );
  }, [entries, fallbackSessionName, i18n.language, search, sessionMetas]);
  const visibleGroups = useMemo(() => {
    const bySession = new Map<string, TeachFeedback[]>();
    for (const entry of visibleEntries) {
      const group = bySession.get(entry.projectId) ?? [];
      group.push(entry);
      bySession.set(entry.projectId, group);
    }
    return [...bySession]
      .map(([sessionId, annotations]) => {
        annotations.sort(
          (left, right) =>
            right.createdAt - left.createdAt ||
            right.updatedAt - left.updatedAt ||
            left.id.localeCompare(right.id)
        );
        return {
          sessionId,
          name: sessionDisplayName(
            sessionMetas?.[sessionId],
            sessionId,
            fallbackSessionName
          ),
          createdAt:
            sessionMetas?.[sessionId]?.createdAt ?? annotations[0].createdAt,
          annotations,
        };
      })
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt ||
          left.sessionId.localeCompare(right.sessionId)
      );
  }, [fallbackSessionName, sessionMetas, visibleEntries]);
  useEffect(() => {
    const firstEntry = visibleGroups[0]?.annotations[0];
    if (initializedExpansion.current || !firstEntry) return;
    initializedExpansion.current = true;
    setExpandedIds(new Set([firstEntry.id]));
  }, [visibleGroups]);
  const allVisibleExpanded =
    visibleEntries.length > 0 &&
    visibleEntries.every((entry) => expandedIds.has(entry.id));

  const sourceLabel = (sourceType: TeachFeedbackSourceType) => {
    const labels: Record<TeachFeedbackSourceType, string> = {
      'agent-log': t('chat.teach-agent-log', { defaultValue: 'Agent log' }),
      run: t('chat.teach-whole-run', { defaultValue: 'Whole run' }),
      artifact: t('chat.teach-artifact', { defaultValue: 'Artifact' }),
      file: t('chat.teach-file', { defaultValue: 'File' }),
      browser: t('chat.teach-browser', { defaultValue: 'Browser' }),
      review: t('chat.teach-review', { defaultValue: 'Review' }),
      terminal: t('chat.teach-terminal', { defaultValue: 'Terminal' }),
      session: t('chat.teach-session', { defaultValue: 'Session' }),
    };
    return labels[sourceType];
  };

  const viewSource = (entry: TeachFeedback) => {
    const escapedSourceId = CSS.escape(entry.sourceId);
    const selector = `[data-teach-feedback-source="${escapedSourceId}"], [data-run-id="${escapedSourceId}"], [data-narrative-event-motion-id="${escapedSourceId}"], [data-detailed-trace-row="${escapedSourceId}"]`;
    const source = document.querySelector<HTMLElement>(selector);
    if (source) {
      source.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const tabs = usePageTabStore.getState();
    if (tabs.sessionPreviewProjectId === entry.projectId) {
      const preview = getSessionPreviewSlice(tabs);
      const matchingTab = preview.tabs.find((tab) => {
        if (entry.sourceType === 'file' && tab.type === 'file' && tab.file) {
          return (
            `file:${getWorkspaceRelativeFilePath(tab.file)}` === entry.sourceId
          );
        }
        if (entry.sourceType === 'browser' && tab.type === 'browser') {
          return `browser:${tab.id}` === entry.sourceId;
        }
        if (entry.sourceType === 'terminal' && tab.type === 'terminal') {
          return `terminal:${tab.agentSourceId ?? tab.id}` === entry.sourceId;
        }
        return false;
      });
      if (matchingTab) {
        tabs.selectSessionPreviewTab(matchingTab.id);
        return;
      }
      if (entry.sourceType === 'review') {
        tabs.openReviewPreview({
          runId: entry.runId,
          path: entry.contextDetail,
        });
        return;
      }
    }
    toast.info(
      t('chat.teach-work-unavailable', {
        defaultValue: 'This work is not open in the current session.',
      })
    );
  };

  const toggleAllVisible = () => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      for (const entry of visibleEntries) {
        if (allVisibleExpanded) next.delete(entry.id);
        else next.add(entry.id);
      }
      return next;
    });
  };

  const toggleEntry = (id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-ds-neutral-default-default">
      <ContentHeader
        height="adaptive"
        className="flex-wrap gap-y-ds-4 bg-ds-neutral-subtle-default py-ds-4"
      >
        <div className="flex flex-wrap items-center gap-1">
          {(['session', 'space'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className={cn(
                scope === value &&
                  '!bg-ds-bg-teach-mode-muted-default !text-ds-ink-inverse'
              )}
            >
              {value === 'session'
                ? t('chat.teach-this-session', {
                    defaultValue: 'This session',
                  })
                : t('chat.teach-this-space', {
                    defaultValue: 'This space',
                  })}{' '}
              ({new Intl.NumberFormat(i18n.language).format(counts[value])})
            </Button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
          <SearchInput
            variant="icon"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('chat.teach-search-annotations', {
              defaultValue: 'Search annotations…',
            })}
            ariaLabel={t('chat.teach-search-annotations', {
              defaultValue: 'Search annotations…',
            })}
            searchTooltip={t('chat.teach-search-annotations', {
              defaultValue: 'Search annotations…',
            })}
            clearOnEscape
          />
          <TooltipSimple
            content={
              allVisibleExpanded
                ? t('chat.teach-fold-all', { defaultValue: 'Fold all' })
                : t('chat.teach-expand-all', { defaultValue: 'Expand all' })
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              disabled={visibleEntries.length === 0}
              aria-label={
                allVisibleExpanded
                  ? t('chat.teach-fold-all', { defaultValue: 'Fold all' })
                  : t('chat.teach-expand-all', { defaultValue: 'Expand all' })
              }
              onClick={toggleAllVisible}
            >
              <DsIcon
                icon={allVisibleExpanded ? ChevronsDownUp : ChevronsUpDown}
                recipe="main"
              />
            </Button>
          </TooltipSimple>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!activeSpaceId || !projectId}
            onClick={() => {
              if (!activeSpaceId || !projectId) return;
              setComment('');
              setFileReferences([]);
              setPendingAnnotation({
                spaceId: activeSpaceId,
                projectId,
                sourceType: 'session',
                sourceId: `session:manual:${crypto.randomUUID()}`,
                contextLabel: t('chat.teach-session', {
                  defaultValue: 'Session',
                }),
              });
            }}
          >
            <Plus aria-hidden />
            {t('layout.new', { defaultValue: 'New' })}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled
            aria-description={t('layout.coming-soon', {
              defaultValue: 'Coming soon',
            })}
          >
            {t('chat.teach-convert', { defaultValue: 'Convert' })}
          </Button>
        </div>
      </ContentHeader>
      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
        {pendingAnnotation ? (
          <section className="flex flex-col gap-2 border-x-0 border-y-0 border-b border-ds-hairline-subtle-default p-ds-panel-inset">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-ds-text-base font-semibold text-ds-ink-default-default">
                  {pendingAnnotation.contextLabel}
                </span>
                {pendingAnnotation.contextDetail ? (
                  <span className="block truncate text-ds-text-meta text-ds-ink-muted-default">
                    {pendingAnnotation.contextDetail}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                aria-label={t('common.close', { defaultValue: 'Close' })}
                onClick={() => setPendingAnnotation(null)}
              >
                <X aria-hidden />
              </Button>
            </div>
            {pendingAnnotation.selectedText ? (
              <blockquote className="line-clamp-4 border-x-0 border-y-0 border-l-2 border-ds-border-teach-mode-default-default pl-2 text-ds-text-meta text-ds-ink-muted-default">
                {pendingAnnotation.selectedText}
              </blockquote>
            ) : null}
            <TeachCommentInput
              autoFocus
              value={comment}
              onChange={setComment}
              references={fileReferences}
              onReferencesChange={setFileReferences}
              spaceId={pendingAnnotation.spaceId}
              projectId={pendingAnnotation.projectId}
              scope={scope}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={!comment.trim()}
                onClick={() => {
                  addAnnotation(pendingAnnotation, comment, fileReferences);
                  setPendingAnnotation(null);
                  setComment('');
                  setFileReferences([]);
                }}
              >
                {t('chat.teach-save-comment', { defaultValue: 'Save comment' })}
              </Button>
            </div>
          </section>
        ) : null}
        {entries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-ds-panel-inset text-center text-ds-ink-muted-default">
            <DsIcon icon={SquareDashedMousePointer} recipe="detailed" />
            <span className="text-ds-text-base font-medium">
              {t('chat.teach-feedback-empty', {
                defaultValue: 'Your annotations will appear here.',
              })}
            </span>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="flex h-full items-center justify-center p-ds-panel-inset text-center text-ds-text-base text-ds-ink-muted-default">
            {t('chat.teach-no-matching-annotations', {
              defaultValue: 'No annotations match your search.',
            })}
          </div>
        ) : (
          <div className="flex flex-col gap-ds-16 p-ds-panel-inset">
            {visibleGroups.map((group, index) => (
              <section
                key={group.sessionId}
                aria-label={group.name}
                className="flex flex-col gap-ds-12"
              >
                {index > 0 ? (
                  <Separator className="bg-ds-hairline-subtle-default" />
                ) : null}
                <h2 className="m-0 text-ds-text-base font-semibold text-ds-ink-muted-default">
                  {group.name}
                </h2>
                <div className="flex flex-col gap-ds-8">
                  {group.annotations.map((entry) => (
                    <AnnotationItem
                      key={entry.id}
                      entry={entry}
                      sourceLabel={sourceLabel(entry.sourceType)}
                      timeLabel={new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(entry.createdAt)}
                      expanded={expandedIds.has(entry.id)}
                      onToggle={() => toggleEntry(entry.id)}
                      onViewWork={
                        entry.sourceType === 'session'
                          ? undefined
                          : () => viewSource(entry)
                      }
                      scope={scope}
                      onSave={(comment, references) =>
                        updateAnnotation(entry.id, comment, references)
                      }
                      onDelete={() => {
                        deleteAnnotation(entry.id);
                        setExpandedIds((previous) => {
                          const next = new Set(previous);
                          next.delete(entry.id);
                          return next;
                        });
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
