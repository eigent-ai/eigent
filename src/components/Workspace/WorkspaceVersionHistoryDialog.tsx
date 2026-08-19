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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
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
          defaultValue: 'Failed to load version history.',
        })
      );
    } finally {
      setLoading(false);
    }
  }, [email, identity, spaceId, t]);

  useEffect(() => {
    if (open) {
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
          defaultValue: 'This Git command is not allowed.',
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
          defaultValue: 'Git operation failed. Refresh before retrying.',
        })
      );
    } finally {
      setCommandBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" overlayVariant="dimmed">
        <DialogHeader
          title={t('layout.workspace-version-history', {
            defaultValue: 'Version history',
          })}
          subtitle={t('layout.workspace-version-history-subtitle', {
            defaultValue:
              'Browse saved Space and task versions. Technical Git details are available below.',
          })}
        />
        <DialogContentSection className="scrollbar-overlay min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {loading && !history ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          ) : null}

          {history && versionView ? (
            <>
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-body-sm font-bold">
                      {t('layout.workspace-current-version', {
                        defaultValue: 'Current Space',
                      })}
                    </h3>
                    <p className="text-body-xs text-ds-text-neutral-muted-default">
                      {t('layout.workspace-current-version-description', {
                        defaultValue:
                          'The latest save point for files visible in this Space.',
                      })}
                    </p>
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
                  <div className="flex items-center gap-3 rounded-xl border border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-4">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ds-bg-success-subtle-default">
                      <CheckCircle2
                        className="size-5 text-ds-icon-success-default-default"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-body-sm font-semibold">
                        {t('layout.workspace-latest-save-point', {
                          defaultValue: 'Latest save point',
                        })}
                      </p>
                      <p className="truncate text-body-xs text-ds-text-neutral-muted-default">
                        {versionView.currentSpace.subject ||
                          t('layout.workspace-saved-version', {
                            defaultValue: 'Saved version',
                          })}{' '}
                        · {formatDate(versionView.currentSpace.committed_at)}
                      </p>
                    </div>
                    <code className="shrink-0 rounded-md border border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-2 py-1 text-body-xs text-ds-text-neutral-muted-default">
                      {versionView.currentSpace.oid.slice(0, 8)}
                    </code>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-ds-border-neutral-default-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                    {t('layout.workspace-no-save-point', {
                      defaultValue: 'No Space save point is available yet.',
                    })}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-body-sm font-bold">
                      {t('layout.workspace-project-versions', {
                        defaultValue: 'Project versions',
                      })}
                    </h3>
                    <span className="rounded-full bg-ds-bg-neutral-strong-default px-2 py-0.5 text-body-xs">
                      {versionView.projectVersions.length}
                    </span>
                  </div>
                  <p className="text-body-xs text-ds-text-neutral-muted-default">
                    {t('layout.workspace-project-versions-description', {
                      defaultValue:
                        'The latest retained version for each Project in this Space.',
                    })}
                  </p>
                </div>
                <div className="divide-y divide-ds-border-neutral-default-default rounded-xl border border-ds-border-neutral-default-default">
                  {versionView.projectVersions.map((branch) => (
                    <div
                      key={branch.ref}
                      className="flex items-center gap-3 px-3 py-3"
                    >
                      <FolderGit2
                        className="size-4 shrink-0 text-ds-icon-neutral-muted-default"
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-semibold">
                          {(branch.project_id &&
                            projectNames.get(branch.project_id)) ||
                            t('layout.workspace-project-version', {
                              defaultValue: 'Project version',
                            })}
                        </p>
                        <p className="truncate text-body-xs text-ds-text-neutral-muted-default">
                          {branch.subject.startsWith(
                            'Initialize Eigent Project workspace'
                          )
                            ? t('layout.workspace-project-initialized', {
                                defaultValue: 'Project initialized',
                              })
                            : t('layout.workspace-project-updated', {
                                defaultValue: 'Project updated',
                              })}{' '}
                          · {formatDate(branch.committed_at)}
                        </p>
                      </div>
                      <code className="shrink-0 rounded-md border border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default px-2 py-0.5 text-body-xs text-ds-text-neutral-muted-default">
                        {branch.oid.slice(0, 8)}
                      </code>
                    </div>
                  ))}
                  {versionView.projectVersions.length === 0 ? (
                    <p className="p-4 text-body-sm text-ds-text-neutral-muted-default">
                      {t('layout.workspace-no-project-versions', {
                        defaultValue: 'No Project versions are available yet.',
                      })}
                    </p>
                  ) : null}
                </div>
              </section>

              <section className="space-y-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-body-sm font-bold">
                      {t('layout.workspace-task-versions', {
                        defaultValue: 'Task versions',
                      })}
                    </h3>
                    <span className="rounded-full bg-ds-bg-neutral-strong-default px-2 py-0.5 text-body-xs">
                      {versionView.taskVersions.length}
                    </span>
                  </div>
                  <p className="text-body-xs text-ds-text-neutral-muted-default">
                    {t('layout.workspace-task-versions-description', {
                      defaultValue:
                        'One saved entry per task. Internal execution branches are grouped automatically.',
                    })}
                  </p>
                </div>
                <div className="divide-y divide-ds-border-neutral-default-default rounded-xl border border-ds-border-neutral-default-default">
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
                        className="flex items-center gap-3 px-3 py-3"
                      >
                        <History
                          className="size-4 shrink-0 text-ds-icon-neutral-muted-default"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-sm font-semibold">
                            {projectName ||
                              t('layout.workspace-task-version', {
                                defaultValue: 'Task version',
                              })}
                          </p>
                          <p className="truncate text-body-xs text-ds-text-neutral-muted-default">
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
                              ? ` · ${taskVersion.agentCount} ${
                                  taskVersion.agentCount === 1
                                    ? 'agent'
                                    : 'agents'
                                }`
                              : ''}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-ds-bg-neutral-strong-default px-2 py-0.5 text-body-xs">
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
                    <p className="p-4 text-body-sm text-ds-text-neutral-muted-default">
                      {t('layout.workspace-no-task-versions', {
                        defaultValue: 'No task versions are available yet.',
                      })}
                    </p>
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
                          defaultValue: `Show all ${versionView.taskVersions.length} task versions`,
                        })}
                  </Button>
                ) : null}
              </section>

              <section className="space-y-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-body-sm font-bold">
                      {t('layout.workspace-recent-commits', {
                        defaultValue: 'Recent checkpoints and commits',
                      })}
                    </h3>
                    <span className="rounded-full bg-ds-bg-neutral-strong-default px-2 py-0.5 text-body-xs">
                      {timelineEvents.length}
                    </span>
                  </div>
                  <p className="text-body-xs text-ds-text-neutral-muted-default">
                    {t('layout.workspace-recent-commits-description', {
                      defaultValue:
                        'A chronological Git view of save points, task checkpoints, and merges.',
                    })}
                  </p>
                </div>
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
                          defaultValue: `Show all ${timelineEvents.length} events`,
                        })}
                  </Button>
                ) : null}
              </section>

              {history.large_repository.warning ? (
                <div className="flex gap-2 rounded-xl border border-ds-border-warning-default-default p-3 text-body-sm">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  <span>
                    {t('layout.workspace-large-repository-warning', {
                      defaultValue:
                        'This is a large repository. Prefer Git LFS for large generated assets; automatic GC is disabled.',
                    })}
                  </span>
                </div>
              ) : null}

              <Accordion type="multiple" className="space-y-2">
                <AccordionItem
                  value="technical-details"
                  className="rounded-xl border border-ds-border-neutral-default-default px-3"
                >
                  <AccordionTrigger className="gap-3 py-3 hover:no-underline">
                    <div className="flex min-w-0 items-center gap-3 text-left">
                      <GitBranch className="size-4 shrink-0" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-body-sm font-semibold">
                          {t('layout.workspace-technical-details', {
                            defaultValue: 'Technical details',
                          })}
                        </p>
                        <p className="text-body-xs font-normal text-ds-text-neutral-muted-default">
                          {t('layout.workspace-technical-details-description', {
                            count: versionView.technicalBranches.length,
                            defaultValue: `${versionView.technicalBranches.length} internal Git references and retention details`,
                          })}
                        </p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pb-3">
                    <div className="space-y-2">
                      <h4 className="text-body-xs font-semibold">
                        {t('layout.workspace-git-references', {
                          defaultValue: 'Git references',
                        })}
                      </h4>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {versionView.technicalBranches.map((branch) => (
                          <div
                            key={branch.ref}
                            className="min-w-0 rounded-lg bg-ds-bg-neutral-subtle-default p-2.5"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <code className="min-w-0 flex-1 truncate text-body-xs">
                                {technicalRefLabel(branch.ref)}
                              </code>
                              {branch.archived ? (
                                <span className="shrink-0 rounded-full bg-ds-bg-neutral-strong-default px-1.5 py-0.5 text-body-xs">
                                  archived
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-body-xs text-ds-text-neutral-muted-default">
                              {branch.oid.slice(0, 8)} ·{' '}
                              {formatDate(branch.committed_at)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-body-xs text-ds-text-neutral-muted-default">
                      Automatic archive deletion and object GC are disabled.
                      Encrypted Space backup is not configured implicitly and
                      remains a separate, explicit product setup.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem
                  value="advanced-git"
                  className="rounded-xl border border-ds-border-neutral-default-default px-3"
                >
                  <AccordionTrigger className="gap-3 py-3 hover:no-underline">
                    <div className="flex min-w-0 items-center gap-3 text-left">
                      <GitCommitHorizontal
                        className="size-4 shrink-0"
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-body-sm font-semibold">
                          Advanced Git
                        </p>
                        <p className="text-body-xs font-normal text-ds-text-neutral-muted-default">
                          Preview and run policy-gated Git commands.
                        </p>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-3">
                    <p className="text-body-xs text-ds-text-neutral-muted-default">
                      Enter argv as a JSON string array. No shell is used. The
                      exact classified action is reviewed before execution.
                    </p>
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
                      <div className="rounded-lg bg-ds-bg-neutral-strong-default p-3 text-body-xs">
                        <p>
                          <strong>{preview.classification}</strong> ·{' '}
                          {preview.effect}
                        </p>
                        <p className="mt-1 break-all font-mono">
                          {preview.display_argv.join(' ')}
                        </p>
                        {preview.requires_confirmation ? (
                          <p className="mt-1 text-ds-text-warning-strong-default">
                            Exact action confirmation required.
                          </p>
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
                        Preview
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
                        Execute
                      </Button>
                    </div>
                    {commandOutput ? (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-ds-bg-neutral-strong-default p-3 text-body-xs">
                        {commandOutput}
                      </pre>
                    ) : null}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </>
          ) : null}
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
