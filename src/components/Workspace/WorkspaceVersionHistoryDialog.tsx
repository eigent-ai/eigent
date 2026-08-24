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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  buildWorkspaceTimelineEvents,
  WorkspaceCommitTimeline,
} from '@/components/Workspace/WorkspaceCommitTimeline';
import {
  buildWorkspaceVersionHistoryView,
  technicalRefLabel,
} from '@/components/Workspace/workspaceVersionHistoryView';
import {
  executeAdvancedGit,
  fetchWorkspaceGitHistory,
  previewAdvancedGit,
  type AdvancedGitPreview,
  type WorkspaceGitHistory,
} from '@/service/workspaceGitApi';
import {
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  AlertTriangle,
  CheckCircle2,
  FolderGit2,
  GitBranch,
  GitCommitHorizontal,
  History,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface WorkspaceVersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spaceId: string | null;
  email: string | null;
  userId: string | number | null;
  actorId: string;
}

const formatDate = (seconds: number) =>
  seconds > 0 ? new Date(seconds * 1000).toLocaleString() : '—';

type VersionHistoryTab = 'projects' | 'tasks' | 'commits' | 'technical';

export function WorkspaceVersionHistoryDialog({
  open,
  onOpenChange,
  spaceId,
  email,
  userId,
  actorId,
}: WorkspaceVersionHistoryDialogProps) {
  const { t } = useTranslation();
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const [history, setHistory] = useState<WorkspaceGitHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<VersionHistoryTab>('projects');
  const [showAllTaskVersions, setShowAllTaskVersions] = useState(false);
  const [showAllCommits, setShowAllCommits] = useState(false);
  const [argvText, setArgvText] = useState('["status", "--short"]');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<AdvancedGitPreview | null>(null);
  const [commandOutput, setCommandOutput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);

  const identity = useMemo(
    () => ({ email: email || '', userId }),
    [email, userId]
  );
  const projectNames = useMemo(
    () =>
      new Map(
        getVisibleProjectMetasForSpace(projectsBySpaceId, spaceId).map(
          (project) => [project.id, project.name]
        )
      ),
    [projectsBySpaceId, spaceId]
  );
  const versionView = useMemo(
    () => (history ? buildWorkspaceVersionHistoryView(history.branches) : null),
    [history]
  );
  const projectNameByOid = useMemo(() => {
    const names = new Map<string, string>();
    for (const branch of versionView?.projectVersions ?? []) {
      const name = branch.project_id
        ? projectNames.get(branch.project_id)
        : null;
      if (name) names.set(branch.oid, name);
    }
    return names;
  }, [projectNames, versionView]);
  const timelineEvents = useMemo(
    () =>
      history
        ? buildWorkspaceTimelineEvents(
            history.commits,
            history.operations ?? []
          )
        : [],
    [history]
  );

  const load = useCallback(async () => {
    if (!spaceId || !email) return;
    setLoading(true);
    try {
      setHistory(await fetchWorkspaceGitHistory(spaceId, identity));
    } catch (error) {
      console.warn('[WorkspaceVersionHistory] Failed to load history:', error);
      toast.error(
        t('layout.workspace-version-history-load-failed', {
          defaultValue: "Couldn't load version history. Try again.",
        })
      );
    } finally {
      setLoading(false);
    }
  }, [email, identity, spaceId, t]);

  useEffect(() => {
    if (open) {
      setActiveTab('projects');
      setShowAllTaskVersions(false);
      setShowAllCommits(false);
      void load();
    }
  }, [load, open]);

  const parseArgv = () => {
    const value: unknown = JSON.parse(argvText);
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every((item) => typeof item === 'string')
    ) {
      throw new Error('argv must be a non-empty JSON string array');
    }
    return value as string[];
  };

  const handlePreview = async () => {
    if (!spaceId || !email || commandBusy) return;
    setCommandBusy(true);
    try {
      const next = await previewAdvancedGit(spaceId, identity, {
        operationRequestId: requestId,
        argv: parseArgv(),
      });
      setPreview(next);
      setCommandOutput('');
    } catch (error) {
      console.warn('[WorkspaceVersionHistory] Git preview failed:', error);
      setPreview(null);
      toast.error(
        t('layout.workspace-git-preview-failed', {
          defaultValue: 'That Git command is not allowed here.',
        })
      );
    } finally {
      setCommandBusy(false);
    }
  };

  const handleExecute = async () => {
    if (!spaceId || !email || !preview || commandBusy) return;
    setCommandBusy(true);
    try {
      const result = await executeAdvancedGit(spaceId, identity, {
        operationRequestId: requestId,
        argv: parseArgv(),
        expectedRepoStateDigest: history?.repo_state_digest,
        confirmedActionDigest: preview.requires_confirmation
          ? preview.action_digest
          : null,
        actorId,
      });
      const suffix = [
        result.publish_scan
          ? `Publish preflight passed: ${result.publish_scan.outgoing_object_count} outgoing objects checked.`
          : '',
        result.stdout_truncated ? '[stdout truncated]' : '',
        result.stderr_truncated ? '[stderr truncated]' : '',
      ]
        .filter(Boolean)
        .join('\n');
      setCommandOutput(
        [result.stdout, result.stderr, suffix].filter(Boolean).join('\n') ||
          'Completed.'
      );
      setPreview(null);
      setRequestId(crypto.randomUUID());
      await load();
    } catch (error) {
      console.warn('[WorkspaceVersionHistory] Git execution failed:', error);
      toast.error(
        t('layout.workspace-git-execute-failed', {
          defaultValue: 'The Git command failed. Refresh, then try again.',
        })
      );
    } finally {
      setCommandBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" overlayVariant="dimmed" className="h-[90vh]">
        <DialogHeader
          title={t('layout.workspace-version-history', {
            defaultValue: 'Version history',
          })}
          subtitle={t('layout.workspace-version-history-subtitle', {
            defaultValue:
              'Browse saved versions of this Space and its tasks. Git details are in the Technical tab.',
          })}
        />
        <DialogContentSection className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden p-5">
          {loading && !history ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          ) : null}

          {history && versionView ? (
            <>
              <section className="shrink-0 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="block text-ds-text-base font-bold">
                      {t('layout.workspace-current-version', {
                        defaultValue: 'Current version',
                      })}
                    </span>
                    <span className="block text-ds-text-meta text-ds-ink-muted-default">
                      {t('layout.workspace-current-version-description', {
                        defaultValue:
                          'The most recent save point for the files in this Space.',
                      })}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    buttonContent="icon-only"
                    onClick={() => void load()}
                    disabled={loading}
                    aria-label={t('layout.refresh', {
                      defaultValue: 'Refresh',
                    })}
                  >
                    <RefreshCw className={loading ? 'animate-spin' : ''} />
                  </Button>
                </div>
                {versionView.currentSpace ? (
                  <div className="flex items-center gap-3 rounded-xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default p-4">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ds-bg-success-subtle-default">
                      <CheckCircle2
                        className="size-5 text-ds-icon-success-default-default"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block text-ds-text-base font-semibold">
                        {t('layout.workspace-latest-save-point', {
                          defaultValue: 'Latest save point',
                        })}
                      </span>
                      <span className="block truncate text-ds-text-meta text-ds-ink-muted-default">
                        {versionView.currentSpace.subject ||
                          t('layout.workspace-saved-version', {
                            defaultValue: 'Saved version',
                          })}{' '}
                        · {formatDate(versionView.currentSpace.committed_at)}
                      </span>
                    </div>
                    <code className="shrink-0 rounded-md border border-x border-y border-ds-hairline-default-default bg-ds-neutral-default-default px-2 py-1 text-ds-text-meta text-ds-ink-muted-default">
                      {versionView.currentSpace.oid.slice(0, 8)}
                    </code>
                  </div>
                ) : (
                  <div className="rounded-xl border border-x border-y border-dashed border-ds-hairline-default-default p-4 text-ds-text-base text-ds-ink-muted-default">
                    {t('layout.workspace-no-save-point', {
                      defaultValue:
                        'No save points yet. Save changes from the Space menu to create the first one.',
                    })}
                  </div>
                )}
              </section>

              {history.large_repository.warning ? (
                <div className="flex shrink-0 gap-2 rounded-xl border border-x border-y border-ds-border-warning-default-default p-3 text-ds-text-base">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {t('layout.workspace-large-repository-warning', {
                      defaultValue:
                        'This Space is large. Consider Git LFS for big generated files. Automatic garbage collection is off.',
                    })}
                  </span>
                </div>
              ) : null}

              <Tabs
                value={activeTab}
                onValueChange={(value) =>
                  setActiveTab(value as VersionHistoryTab)
                }
                className="flex min-h-0 flex-1 flex-col"
              >
                <TabsList
                  appearance="default"
                  aria-label={t('layout.workspace-version-history', {
                    defaultValue: 'Version history',
                  })}
                  className="w-full shrink-0"
                >
                  <TabsTrigger
                    value="projects"
                    className="flex-1 gap-1.5 !text-ds-text-base"
                  >
                    {t('layout.workspace-project-versions', {
                      defaultValue: 'Session versions',
                    })}
                    <span className="rounded-full bg-ds-neutral-muted-default px-1.5 py-0.5 !text-ds-text-meta">
                      {versionView.projectVersions.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="tasks"
                    className="flex-1 gap-1.5 !text-ds-text-base"
                  >
                    {t('layout.workspace-task-versions', {
                      defaultValue: 'Task versions',
                    })}
                    <span className="rounded-full bg-ds-neutral-muted-default px-1.5 py-0.5 !text-ds-text-meta">
                      {versionView.taskVersions.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="commits"
                    className="flex-1 gap-1.5 !text-ds-text-base"
                  >
                    {t('layout.workspace-recent-commits', {
                      defaultValue: 'Timeline',
                    })}
                    <span className="rounded-full bg-ds-neutral-muted-default px-1.5 py-0.5 !text-ds-text-meta">
                      {timelineEvents.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger
                    value="technical"
                    className="flex-1 gap-1.5 !text-ds-text-base"
                  >
                    {t('layout.workspace-technical-tab', {
                      defaultValue: 'Technical',
                    })}
                  </TabsTrigger>
                </TabsList>

                <TabsContent
                  value="projects"
                  className="scrollbar-overlay my-2 min-h-0 flex-1 overflow-y-auto pl-2.5"
                >
                  <span className="block text-ds-text-meta text-ds-ink-muted-default">
                    {t('layout.workspace-project-versions-description', {
                      defaultValue:
                        'The most recent saved version of each session in this Space.',
                    })}
                  </span>
                  <div className="overflow-hidden rounded-xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-default-default px-4">
                    {versionView.projectVersions.map((branch) => (
                      <div
                        key={branch.ref}
                        className="flex items-center gap-3 border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default py-3 last:border-x-0 last:border-t-0 last:border-b-0"
                      >
                        <FolderGit2
                          className="size-4 shrink-0 text-ds-ink-muted-default"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-ds-text-base font-semibold">
                            {(branch.project_id &&
                              projectNames.get(branch.project_id)) ||
                              t('layout.workspace-project-version', {
                                defaultValue: 'Session version',
                              })}
                          </span>
                          <span className="block truncate text-ds-text-meta text-ds-ink-muted-default">
                            {branch.subject.startsWith(
                              'Initialize Eigent Project workspace'
                            )
                              ? t('layout.workspace-project-initialized', {
                                  defaultValue: 'Session initialized',
                                })
                              : t('layout.workspace-project-updated', {
                                  defaultValue: 'Session updated',
                                })}{' '}
                            · {formatDate(branch.committed_at)}
                          </span>
                        </div>
                        <code className="shrink-0 rounded-md border border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default px-2 py-0.5 text-ds-text-meta text-ds-ink-muted-default">
                          {branch.oid.slice(0, 8)}
                        </code>
                      </div>
                    ))}
                    {versionView.projectVersions.length === 0 ? (
                      <span className="block py-4 text-ds-text-base text-ds-ink-muted-default">
                        {t('layout.workspace-no-project-versions', {
                          defaultValue:
                            'No session versions yet. They appear once a session saves work.',
                        })}
                      </span>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent
                  value="tasks"
                  className="scrollbar-overlay my-2 min-h-0 flex-1 overflow-y-auto pl-2.5"
                >
                  <span className="block text-ds-text-meta text-ds-ink-muted-default">
                    {t('layout.workspace-task-versions-description', {
                      defaultValue:
                        'One entry per task. Eigent groups the internal Git branches behind each task automatically.',
                    })}
                  </span>
                  <div className="overflow-hidden rounded-xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-default-default px-4">
                    {(showAllTaskVersions
                      ? versionView.taskVersions
                      : versionView.taskVersions.slice(0, 5)
                    ).map((taskVersion) => {
                      const projectName =
                        (taskVersion.branch.project_id &&
                          projectNames.get(taskVersion.branch.project_id)) ||
                        projectNameByOid.get(taskVersion.branch.oid);
                      return (
                        <div
                          key={taskVersion.id}
                          className="flex items-center gap-3 border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default py-3 last:border-x-0 last:border-t-0 last:border-b-0"
                        >
                          <History
                            className="size-4 shrink-0 text-ds-ink-muted-default"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-ds-text-base font-semibold">
                              {projectName ||
                                t('layout.workspace-task-version', {
                                  defaultValue: 'Task version',
                                })}
                            </span>
                            <span className="block truncate text-ds-text-meta text-ds-ink-muted-default">
                              {taskVersion.branch.subject.startsWith(
                                'Initialize Eigent Project workspace'
                              )
                                ? t('layout.workspace-task-workspace-created', {
                                    defaultValue: 'Task workspace created',
                                  })
                                : t('layout.workspace-task-output-saved', {
                                    defaultValue: 'Task output saved',
                                  })}{' '}
                              · {formatDate(taskVersion.branch.committed_at)}
                              {taskVersion.agentCount > 0
                                ? ` · ${t(
                                    'layout.workspace-task-version-agent-count',
                                    {
                                      count: taskVersion.agentCount,
                                      defaultValue_one: '{{count}} agent',
                                      defaultValue_other: '{{count}} agents',
                                    }
                                  )}`
                                : ''}
                            </span>
                          </div>
                          <span className="shrink-0 rounded-full bg-ds-neutral-strong-default px-2 py-0.5 text-ds-text-meta">
                            {taskVersion.archived
                              ? t('layout.workspace-version-retained', {
                                  defaultValue: 'Retained',
                                })
                              : t('layout.workspace-version-active', {
                                  defaultValue: 'Active',
                                })}
                          </span>
                        </div>
                      );
                    })}
                    {versionView.taskVersions.length === 0 ? (
                      <span className="block py-4 text-ds-text-base text-ds-ink-muted-default">
                        {t('layout.workspace-no-task-versions', {
                          defaultValue:
                            'No task versions yet. They appear once a task saves output.',
                        })}
                      </span>
                    ) : null}
                  </div>
                  {versionView.taskVersions.length > 5 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllTaskVersions((value) => !value)}
                    >
                      {showAllTaskVersions
                        ? t('layout.workspace-show-recent-task-versions', {
                            defaultValue: 'Show recent only',
                          })
                        : t('layout.workspace-show-all-task-versions', {
                            count: versionView.taskVersions.length,
                            defaultValue_one: 'Show all {{count}} task version',
                            defaultValue_other:
                              'Show all {{count}} task versions',
                          })}
                    </Button>
                  ) : null}
                </TabsContent>

                <TabsContent
                  value="commits"
                  className="scrollbar-overlay my-2 min-h-0 flex-1 overflow-y-auto pl-2.5"
                >
                  <span className="block text-ds-text-meta text-ds-ink-muted-default">
                    {t('layout.workspace-recent-commits-description', {
                      defaultValue:
                        'Every save point, task checkpoint, and merge in this Space, newest first.',
                    })}
                  </span>
                  <WorkspaceCommitTimeline
                    events={
                      showAllCommits
                        ? timelineEvents
                        : timelineEvents.slice(0, 10)
                    }
                  />
                  {timelineEvents.length > 10 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllCommits((value) => !value)}
                    >
                      {showAllCommits
                        ? t('layout.workspace-show-recent-commits', {
                            defaultValue: 'Show recent only',
                          })
                        : t('layout.workspace-show-all-commits', {
                            count: timelineEvents.length,
                            defaultValue_one: 'Show all {{count}} event',
                            defaultValue_other: 'Show all {{count}} events',
                          })}
                    </Button>
                  ) : null}
                </TabsContent>

                <TabsContent
                  value="technical"
                  className="scrollbar-overlay my-2 min-h-0 flex-1 overflow-y-auto pl-2.5"
                >
                  <div className="space-y-2">
                    <div className="flex min-w-0 items-center gap-3 py-2">
                      <GitBranch className="size-4 shrink-0" aria-hidden />
                      <div className="min-w-0">
                        <span className="block text-ds-text-base font-semibold">
                          {t('layout.workspace-technical-details', {
                            defaultValue: 'Technical details',
                          })}
                        </span>
                        <span className="block text-ds-text-meta font-normal text-ds-ink-muted-default">
                          {t('layout.workspace-technical-details-description', {
                            count: versionView.technicalBranches.length,
                            defaultValue_one:
                              '{{count}} internal Git reference and retention details',
                            defaultValue_other:
                              '{{count}} internal Git references and retention details',
                          })}
                        </span>
                      </div>
                    </div>
                    <span className="block text-ds-text-meta font-semibold">
                      {t('layout.workspace-git-references', {
                        defaultValue: 'Git references',
                      })}
                    </span>
                    <div className="overflow-hidden rounded-xl border border-x border-y border-ds-hairline-default-default bg-ds-neutral-default-default px-4">
                      {versionView.technicalBranches.map((branch) => (
                        <div
                          key={branch.ref}
                          className="flex min-w-0 items-center gap-3 border-x-0 border-t-0 border-b-[0.5px] border-solid border-ds-hairline-default-default py-3 last:border-x-0 last:border-t-0 last:border-b-0"
                        >
                          <GitBranch
                            className="size-4 shrink-0 text-ds-ink-muted-default"
                            aria-hidden
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate text-ds-text-base font-semibold">
                              {technicalRefLabel(branch.ref)}
                            </span>
                            <span className="block truncate text-ds-text-meta text-ds-ink-muted-default">
                              {branch.oid.slice(0, 8)} ·{' '}
                              {formatDate(branch.committed_at)}
                            </span>
                          </div>
                          {branch.archived ? (
                            <span className="shrink-0 rounded-full bg-ds-neutral-strong-default px-2 py-0.5 text-ds-text-meta">
                              {t('layout.archived', {
                                defaultValue: 'Archived',
                              })}
                            </span>
                          ) : null}
                        </div>
                      ))}
                      {versionView.technicalBranches.length === 0 ? (
                        <span className="block py-4 text-ds-text-base text-ds-ink-muted-default">
                          {t('layout.workspace-no-git-references', {
                            defaultValue: 'No Git references yet.',
                          })}
                        </span>
                      ) : null}
                    </div>
                    <span className="block text-ds-text-meta text-ds-ink-muted-default">
                      {t('layout.workspace-version-retention-description', {
                        defaultValue:
                          'Nothing is deleted automatically, and Git garbage collection is off. Encrypted Space backup is a separate setting — turning on version history does not enable it.',
                      })}
                    </span>
                  </div>

                  <div className="space-y-3">
                    <div className="flex min-w-0 items-center gap-3 py-2">
                      <GitCommitHorizontal
                        className="size-4 shrink-0"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <span className="block text-ds-text-base font-semibold">
                          {t('layout.workspace-advanced-git', {
                            defaultValue: 'Advanced Git',
                          })}
                        </span>
                        <span className="block text-ds-text-meta font-normal text-ds-ink-muted-default">
                          {t('layout.workspace-advanced-git-description', {
                            defaultValue:
                              'Preview a Git command before you run it. Only allowed commands work here.',
                          })}
                        </span>
                      </div>
                    </div>
                    <span className="block text-ds-text-meta text-ds-ink-muted-default">
                      {t('layout.workspace-git-command-instructions', {
                        example: '["status", "--short"]',
                        defaultValue:
                          'Enter the command as a JSON array of arguments, for example {{example}}. No shell is involved, and Eigent checks what the command does before running it.',
                      })}
                    </span>
                    <Textarea
                      value={argvText}
                      onChange={(event) => {
                        setArgvText(event.target.value);
                        setPreview(null);
                        setRequestId(crypto.randomUUID());
                      }}
                      className="min-h-20 font-mono"
                      spellCheck={false}
                    />
                    {preview ? (
                      <div className="rounded-lg bg-ds-neutral-strong-default p-3 text-ds-text-meta">
                        <span className="block">
                          <strong>{preview.classification}</strong> ·{' '}
                          {preview.effect}
                        </span>
                        <span className="mt-1 block font-mono break-all">
                          {preview.display_argv.join(' ')}
                        </span>
                        {preview.requires_confirmation ? (
                          <span className="mt-1 block text-ds-text-warning-strong-default">
                            {t('layout.workspace-git-command-confirmation', {
                              defaultValue:
                                'This command needs confirmation before it runs.',
                            })}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handlePreview()}
                        disabled={commandBusy}
                      >
                        {t('layout.preview', { defaultValue: 'Preview' })}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleExecute()}
                        disabled={
                          !preview || preview.effect === 'deny' || commandBusy
                        }
                      >
                        {commandBusy ? (
                          <Loader2 className="animate-spin" aria-hidden />
                        ) : (
                          <Play aria-hidden />
                        )}
                        {t('layout.run', { defaultValue: 'Run' })}
                      </Button>
                    </div>
                    {commandOutput ? (
                      <pre className="max-h-48 overflow-auto rounded-lg bg-ds-neutral-strong-default p-3 text-ds-text-meta whitespace-pre-wrap">
                        {commandOutput}
                      </pre>
                    ) : null}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          ) : null}
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
