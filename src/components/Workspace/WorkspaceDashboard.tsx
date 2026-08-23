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

import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import ContentHeader from '@/components/Layout/ContentHeader';
import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useSpaceStore } from '@/store/spaceStore';
import { useInView, useReducedMotion } from 'framer-motion';
import {
  CheckCircle2,
  Circle,
  FileText,
  Link2,
  ListTodo,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useWorkspaceDashboardFiles } from './useWorkspaceDashboardFiles';
import {
  getWorkspaceDashboardFileId,
  parseWorkspaceMarkdownTasks,
  readWorkspaceDashboardConfig,
  updateWorkspaceDashboardSources,
  WORKSPACE_DASHBOARD_SECTIONS,
  type WorkspaceDashboardSection,
  type WorkspaceMarkdownTask,
} from './workspaceDashboardModel';

type LoadMarkdownContent = (
  file: FileInfo,
  signal?: AbortSignal
) => Promise<FileInfo>;

const SECTION_LABEL_KEYS: Record<WorkspaceDashboardSection, string> = {
  overview: 'dashboard.workspace-crm.overview',
  accounts: 'dashboard.workspace-crm.accounts',
  delivery: 'dashboard.workspace-crm.delivery',
  approvals: 'dashboard.workspace-crm.approvals',
  launch: 'dashboard.workspace-crm.launch',
  risks: 'dashboard.workspace-crm.risks',
  todos: 'dashboard.workspace-crm.todos',
};

// Ends the composer stage just below visual center so the input sits roughly
// 60% up from the window bottom while the tabs remain next in document flow.
const WORKSPACE_COMPOSER_STAGE_CLASS =
  'flex min-h-[55vh] w-full shrink-0 items-end justify-center px-ds-page-gutter pt-ds-48 pb-ds-64';

const WORKSPACE_TAB_REVEAL_TRANSITION_CLASS =
  'transition-opacity duration-[200ms] ease-[cubic-bezier(0.23,1,0.32,1)]';

function fileDirectory(file: FileInfo): string | null {
  const normalizedPath = file.path.replace(/\\/g, '/');
  const lastSlash = normalizedPath.lastIndexOf('/');
  return lastSlash > 0 ? normalizedPath.slice(0, lastSlash) : null;
}

function WorkspaceDashboardEmpty({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: typeof FileText;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col items-center justify-center rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default text-center',
        compact ? 'px-ds-16 py-ds-24' : 'min-h-48 px-ds-24 py-ds-40'
      )}
    >
      <DsIcon
        icon={icon}
        recipe="detailed"
        className="mb-ds-12 text-ds-ink-muted-default"
      />
      <DsText as="h3" role="body-large" weight="semibold">
        {title}
      </DsText>
      <DsText role="base" className="mt-ds-4 text-ds-ink-muted-default">
        {description}
      </DsText>
      {action ? <div className="mt-ds-16">{action}</div> : null}
    </div>
  );
}

function MarkdownFileCard({
  file,
  loadContent,
}: {
  file: FileInfo;
  loadContent: LoadMarkdownContent;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void loadContent(file, controller.signal)
      .then((loadedFile) => {
        if (!controller.signal.aborted) setContent(loadedFile.content ?? '');
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        console.warn(
          '[WorkspaceDashboard] Failed to load linked file:',
          loadError
        );
        setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [file, loadContent]);

  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader className="gap-ds-4 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default">
        <div className="flex min-w-0 items-center gap-ds-8">
          <DsIcon icon={FileText} className="text-ds-ink-muted-default" />
          <DsText
            as="h3"
            role="body-large"
            weight="semibold"
            className="min-w-0 flex-1 truncate"
            title={file.name}
          >
            {file.name}
          </DsText>
        </div>
        <DsText
          role="meta"
          className="truncate text-ds-ink-muted-default"
          title={file.relativePath || file.path}
        >
          {file.relativePath || file.path}
        </DsText>
      </CardHeader>
      <CardContent className="min-w-0 pt-ds-card-inset">
        {loading ? (
          <div className="space-y-ds-8" aria-label={t('chat.loading')}>
            <Skeleton className="h-ds-20 w-2/3" />
            <Skeleton className="h-ds-12 w-full" />
            <Skeleton className="h-ds-12 w-5/6" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-ds-8 text-ds-ink-muted-default">
            <DsIcon icon={TriangleAlert} />
            <DsText role="base">
              {t('dashboard.workspace-crm.file-preview-error')}
            </DsText>
          </div>
        ) : content ? (
          <MarkDown
            content={content}
            contentBasePath={fileDirectory(file)}
            profile="document"
            enableTypewriter={false}
          />
        ) : (
          <DsText role="base" className="text-ds-ink-muted-default">
            {t('dashboard.workspace-crm.empty-file')}
          </DsText>
        )}
      </CardContent>
    </Card>
  );
}

function WorkspaceSourceDialog({
  open,
  section,
  files,
  selectedIds,
  loading,
  error,
  onOpenChange,
  onSave,
  onRefresh,
}: {
  open: boolean;
  section: WorkspaceDashboardSection;
  files: FileInfo[];
  selectedIds: readonly string[];
  loading: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (sourceIds: string[]) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [draftIds, setDraftIds] = useState<string[]>([]);

  useEffect(() => {
    if (open) setDraftIds([...selectedIds]);
  }, [open, section, selectedIds]);

  const toggleFile = (fileId: string, checked: boolean) => {
    setDraftIds((current) =>
      checked
        ? [...new Set([...current, fileId])]
        : current.filter((id) => id !== fileId)
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" overlayVariant="dimmed">
        <DialogHeader
          title={t('dashboard.workspace-crm.link-files-title', {
            section: t(SECTION_LABEL_KEYS[section]),
          })}
          subtitle={t('dashboard.workspace-crm.link-files-description')}
        />
        <DialogContentSection className="space-y-ds-8">
          {loading ? (
            <div className="space-y-ds-8" aria-label={t('chat.loading')}>
              <Skeleton className="h-ds-control-lg w-full" />
              <Skeleton className="h-ds-control-lg w-full" />
              <Skeleton className="h-ds-control-lg w-full" />
            </div>
          ) : error ? (
            <WorkspaceDashboardEmpty
              compact
              icon={TriangleAlert}
              title={t('dashboard.workspace-crm.files-error')}
              description={error}
              action={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                >
                  <DsIcon icon={RefreshCw} />
                  {t('dashboard.workspace-crm.retry')}
                </Button>
              }
            />
          ) : files.length === 0 ? (
            <WorkspaceDashboardEmpty
              compact
              icon={FileText}
              title={t('dashboard.workspace-crm.no-markdown-files')}
              description={t(
                'dashboard.workspace-crm.no-markdown-files-description'
              )}
            />
          ) : (
            files.map((file, index) => {
              const fileId = getWorkspaceDashboardFileId(file);
              const controlId = `workspace-source-${section}-${index}`;
              return (
                <label
                  key={fileId}
                  htmlFor={controlId}
                  className="flex min-h-ds-control-lg cursor-pointer items-center gap-ds-10 rounded-ds-menu-row px-ds-8 py-ds-6 text-ds-ink-default-default hover:bg-ds-neutral-default-hover"
                >
                  <Checkbox
                    id={controlId}
                    checked={draftIds.includes(fileId)}
                    onCheckedChange={(checked) =>
                      toggleFile(fileId, checked === true)
                    }
                  />
                  <DsIcon
                    icon={FileText}
                    className="text-ds-ink-muted-default"
                  />
                  <span className="min-w-0 flex-1">
                    <DsText
                      as="span"
                      role="base"
                      weight="medium"
                      className="block truncate"
                    >
                      {file.name}
                    </DsText>
                    <DsText
                      as="span"
                      role="meta"
                      className="block truncate text-ds-ink-muted-default"
                    >
                      {file.relativePath || file.path}
                    </DsText>
                  </span>
                </label>
              );
            })
          )}
        </DialogContentSection>
        <DialogFooter
          showCancelButton
          showConfirmButton
          confirmButtonText={t('layout.save')}
          onCancel={() => onOpenChange(false)}
          onConfirm={() => onSave(draftIds)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface TodoFileGroup {
  file: FileInfo;
  loading: boolean;
  error: boolean;
  tasks: WorkspaceMarkdownTask[];
}

function WorkspaceTodoRail({
  files,
  loadContent,
  onLinkFiles,
  onRefresh,
  refreshing,
}: {
  files: FileInfo[];
  loadContent: LoadMarkdownContent;
  onLinkFiles: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<TodoFileGroup[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    setGroups(
      files.map((file) => ({ file, loading: true, error: false, tasks: [] }))
    );

    files.forEach((file) => {
      const fileId = getWorkspaceDashboardFileId(file);
      void loadContent(file, controller.signal)
        .then((loadedFile) => {
          if (controller.signal.aborted) return;
          const tasks = parseWorkspaceMarkdownTasks(
            loadedFile.content ?? '',
            fileId
          );
          setGroups((current) =>
            current.map((group) =>
              getWorkspaceDashboardFileId(group.file) === fileId
                ? { ...group, loading: false, error: false, tasks }
                : group
            )
          );
        })
        .catch((loadError) => {
          if (controller.signal.aborted) return;
          console.warn(
            '[WorkspaceDashboard] Failed to load todo source:',
            loadError
          );
          setGroups((current) =>
            current.map((group) =>
              getWorkspaceDashboardFileId(group.file) === fileId
                ? { ...group, loading: false, error: true }
                : group
            )
          );
        });
    });

    return () => controller.abort();
  }, [files, loadContent]);

  const tasks = groups.flatMap((group) => group.tasks);
  const completedCount = tasks.filter((task) => task.checked).length;

  return (
    <aside
      aria-label={t('dashboard.workspace-crm.todos')}
      className={cn(
        RIGHT_RAIL_CONTENT_WIDTH_CLASS,
        'flex h-full min-h-0 shrink-0 flex-col border-x-0 border-y-0 border-l border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default'
      )}
    >
      <ContentHeader
        title={t('dashboard.workspace-crm.todos')}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              aria-label={t('dashboard.workspace-crm.refresh-files')}
              onClick={onRefresh}
              disabled={refreshing}
            >
              <DsIcon
                icon={RefreshCw}
                className={refreshing ? 'animate-spin' : undefined}
              />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onLinkFiles}
            >
              <DsIcon icon={Link2} />
              {t('dashboard.workspace-crm.link-files')}
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-ds-12 py-ds-16">
        {files.length === 0 ? (
          <WorkspaceDashboardEmpty
            compact
            icon={ListTodo}
            title={t('dashboard.workspace-crm.no-todo-files')}
            description={t('dashboard.workspace-crm.no-todo-files-description')}
            action={
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={onLinkFiles}
              >
                <DsIcon icon={Link2} />
                {t('dashboard.workspace-crm.link-files')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-ds-20">
            <div className="flex items-center justify-between gap-ds-8">
              <DsText role="meta" className="text-ds-ink-muted-default">
                {t('dashboard.workspace-crm.task-progress', {
                  completed: completedCount,
                  total: tasks.length,
                })}
              </DsText>
              <Badge variant="outline" tone="neutral" size="xs">
                {t('dashboard.workspace-crm.linked-file-count', {
                  count: files.length,
                })}
              </Badge>
            </div>
            {groups.map((group) => {
              const groupId = getWorkspaceDashboardFileId(group.file);
              return (
                <section key={groupId} className="min-w-0">
                  <div className="mb-ds-8 flex min-w-0 items-center gap-ds-6">
                    <DsIcon
                      icon={FileText}
                      className="text-ds-ink-muted-default"
                    />
                    <DsText
                      as="h3"
                      role="base"
                      weight="semibold"
                      className="min-w-0 flex-1 truncate"
                      title={group.file.relativePath || group.file.name}
                    >
                      {group.file.name}
                    </DsText>
                  </div>
                  {group.loading ? (
                    <div
                      className="space-y-ds-6"
                      aria-label={t('chat.loading')}
                    >
                      <Skeleton className="h-ds-control-lg w-full" />
                      <Skeleton className="h-ds-control-lg w-5/6" />
                    </div>
                  ) : group.error ? (
                    <DsText
                      role="base"
                      className="text-ds-text-error-default-default"
                    >
                      {t('dashboard.workspace-crm.file-preview-error')}
                    </DsText>
                  ) : group.tasks.length === 0 ? (
                    <DsText role="base" className="text-ds-ink-muted-default">
                      {t('dashboard.workspace-crm.no-tasks-in-file')}
                    </DsText>
                  ) : (
                    <ul className="m-0 space-y-ds-4 p-0">
                      {group.tasks.map((task) => (
                        <li
                          key={task.id}
                          aria-label={
                            task.checked
                              ? `${t('chat.done')}: ${task.text}`
                              : task.text
                          }
                          className="flex min-w-0 items-start gap-ds-8 rounded-ds-menu-row px-ds-6 py-ds-6 hover:bg-ds-neutral-default-hover"
                        >
                          <DsIcon
                            icon={task.checked ? CheckCircle2 : Circle}
                            className={cn(
                              'mt-ds-2',
                              task.checked
                                ? 'text-ds-text-success-default-default'
                                : 'text-ds-ink-muted-default'
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <DsText
                              as="span"
                              role="base"
                              className={cn(
                                'block break-words',
                                task.checked &&
                                  'text-ds-ink-muted-default line-through'
                              )}
                            >
                              {task.text}
                            </DsText>
                            {task.heading ? (
                              <DsText
                                as="span"
                                role="meta"
                                className="mt-ds-2 block truncate text-ds-ink-muted-default"
                              >
                                {task.heading}
                              </DsText>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

export function WorkspaceDashboard({
  composerTop,
  composerInput,
}: {
  composerTop: ReactNode;
  composerInput: ReactNode;
}) {
  const { t } = useTranslation();
  const scrollRootRef = useRef<HTMLElement>(null);
  const tabsRevealRef = useRef<HTMLDivElement>(null);
  const tabsInView = useInView(tabsRevealRef, {
    root: scrollRootRef,
    once: true,
    amount: 0.5,
    margin: '0px 0px -45% 0px',
  });
  const shouldReduceMotion = Boolean(useReducedMotion());
  const tabsRevealed = shouldReduceMotion || tabsInView;
  const { activeSpace, files, loading, error, refresh, loadContent } =
    useWorkspaceDashboardFiles();
  const updateSpace = useSpaceStore((state) => state.updateSpace);
  const updateSpaceOnServer = useSpaceStore(
    (state) => state.updateSpaceOnServer
  );
  const [activeSection, setActiveSection] =
    useState<WorkspaceDashboardSection>('overview');
  const [sourceDialogSection, setSourceDialogSection] =
    useState<WorkspaceDashboardSection | null>(null);
  const config = useMemo(
    () => readWorkspaceDashboardConfig(activeSpace?.metadata),
    [activeSpace?.metadata]
  );

  const filesForSection = useCallback(
    (section: WorkspaceDashboardSection) => {
      const selected = new Set(config.sources[section] ?? []);
      return files.filter((file) =>
        selected.has(getWorkspaceDashboardFileId(file))
      );
    },
    [config.sources, files]
  );

  const linkedTabFiles = filesForSection(activeSection);
  const linkedTodoFiles = filesForSection('todos');
  const availableFileIds = useMemo(
    () => new Set(files.map(getWorkspaceDashboardFileId)),
    [files]
  );

  const saveSources = useCallback(
    (sourceIds: string[]) => {
      if (!activeSpace || !sourceDialogSection) return;
      const nextConfig = updateWorkspaceDashboardSources(
        readWorkspaceDashboardConfig(activeSpace.metadata),
        sourceDialogSection,
        sourceIds
      );
      const nextMetadata = {
        ...activeSpace.metadata,
        workspaceDashboard: nextConfig,
      };
      updateSpace(activeSpace.id, { metadata: nextMetadata });
      setSourceDialogSection(null);
      void updateSpaceOnServer(activeSpace.id, {
        metadata: nextMetadata,
      }).catch((saveError) => {
        console.error(
          '[WorkspaceDashboard] Failed to save file links:',
          saveError
        );
        toast.error(t('dashboard.workspace-crm.save-error'));
      });
    },
    [activeSpace, sourceDialogSection, t, updateSpace, updateSpaceOnServer]
  );

  return (
    <div
      data-workspace-dashboard
      data-workspace-variant="workspace"
      className="relative z-[1] flex h-full min-h-0 w-full min-w-0 flex-row overflow-hidden"
    >
      <main
        ref={scrollRootRef}
        data-workspace-dashboard-scroll-root
        className="scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-y-auto bg-ds-neutral-subtle-default"
      >
        <section
          aria-label="Workspace header"
          className={WORKSPACE_COMPOSER_STAGE_CLASS}
        >
          <div
            data-workspace-input-section
            className="flex w-full max-w-[600px] min-w-0 flex-col"
          >
            {composerTop}
            {composerInput}
          </div>
        </section>

        <Tabs
          value={activeSection}
          onValueChange={(value) =>
            setActiveSection(value as WorkspaceDashboardSection)
          }
          data-workspace-dashboard-tabs-region
          data-workspace-dashboard-tabs-revealed={tabsRevealed}
          className={cn(
            'min-w-0',
            WORKSPACE_TAB_REVEAL_TRANSITION_CLASS,
            tabsRevealed ? 'opacity-100' : 'opacity-40',
            shouldReduceMotion && 'transition-none'
          )}
        >
          <div
            ref={tabsRevealRef}
            data-workspace-dashboard-tabs-sticky
            className="sticky -top-px z-20 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-ds-page-gutter pt-ds-8"
          >
            <div className="flex min-w-0 items-start justify-between gap-ds-16">
              <div className="min-w-0 flex-1 overflow-x-auto pb-ds-2">
                <TabsList appearance="border" className="justify-start">
                  {WORKSPACE_DASHBOARD_SECTIONS.map((section) => (
                    <TabsTrigger key={section} value={section}>
                      {t(SECTION_LABEL_KEYS[section])}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setSourceDialogSection(activeSection)}
              >
                <DsIcon icon={Link2} />
                {t('dashboard.workspace-crm.link-files')}
              </Button>
            </div>
          </div>

          {WORKSPACE_DASHBOARD_SECTIONS.map((section) => (
            <TabsContent
              key={section}
              value={section}
              className="m-0 px-ds-page-gutter py-ds-24"
            >
              {loading ? (
                <div className="grid grid-cols-1 gap-ds-16 2xl:grid-cols-2">
                  <Skeleton className="h-64 w-full rounded-ds-card" />
                  <Skeleton className="h-64 w-full rounded-ds-card" />
                </div>
              ) : error ? (
                <WorkspaceDashboardEmpty
                  icon={TriangleAlert}
                  title={t('dashboard.workspace-crm.files-error')}
                  description={error}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={refresh}
                    >
                      <DsIcon icon={RefreshCw} />
                      {t('dashboard.workspace-crm.retry')}
                    </Button>
                  }
                />
              ) : linkedTabFiles.length === 0 ? (
                <WorkspaceDashboardEmpty
                  icon={FileText}
                  title={t('dashboard.workspace-crm.no-linked-files', {
                    section: t(SECTION_LABEL_KEYS[section]),
                  })}
                  description={t(
                    'dashboard.workspace-crm.no-linked-files-description'
                  )}
                  action={
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setSourceDialogSection(section)}
                    >
                      <DsIcon icon={Link2} />
                      {t('dashboard.workspace-crm.link-files')}
                    </Button>
                  }
                />
              ) : (
                <div className="grid min-w-0 grid-cols-1 gap-ds-16 2xl:grid-cols-2">
                  {linkedTabFiles.map((file) => {
                    const fileId = getWorkspaceDashboardFileId(file);
                    return (
                      <MarkdownFileCard
                        key={`${fileId}:${file.modifiedAt ?? ''}`}
                        file={file}
                        loadContent={loadContent}
                      />
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>

      <WorkspaceTodoRail
        files={linkedTodoFiles}
        loadContent={loadContent}
        onLinkFiles={() => setSourceDialogSection('todos')}
        onRefresh={refresh}
        refreshing={loading}
      />

      <WorkspaceSourceDialog
        open={sourceDialogSection !== null}
        section={sourceDialogSection ?? 'overview'}
        files={files}
        selectedIds={
          sourceDialogSection
            ? (config.sources[sourceDialogSection] ?? []).filter((id) =>
                availableFileIds.has(id)
              )
            : []
        }
        loading={loading}
        error={error}
        onOpenChange={(open) => {
          if (!open) setSourceDialogSection(null);
        }}
        onSave={saveSources}
        onRefresh={refresh}
      />
    </div>
  );
}
