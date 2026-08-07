// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  executeAdvancedGit,
  fetchWorkspaceGitHistory,
  previewAdvancedGit,
  type AdvancedGitPreview,
  type WorkspaceGitHistory,
} from '@/service/workspaceGitApi';
import {
  AlertTriangle,
  GitBranch,
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
  const [history, setHistory] = useState<WorkspaceGitHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [argvText, setArgvText] = useState('["status", "--short"]');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<AdvancedGitPreview | null>(null);
  const [commandOutput, setCommandOutput] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);

  const identity = useMemo(
    () => ({ email: email || '', userId }),
    [email, userId]
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
    if (open) void load();
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
              'Local branches, checkpoints, and policy-gated Git operations.',
          })}
        />
        <DialogContentSection className="scrollbar-overlay min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {loading && !history ? (
            <div className="flex min-h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </div>
          ) : null}

          {history ? (
            <>
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-body-sm font-bold">
                    {t('layout.workspace-branches', {
                      defaultValue: 'Branches',
                    })}
                  </h3>
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
                <div className="grid gap-2 sm:grid-cols-2">
                  {history.branches.map((branch) => (
                    <div
                      key={branch.ref}
                      className="rounded-xl border border-ds-border-neutral-default-default p-3"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <GitBranch className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate text-body-sm font-semibold">
                          {branch.ref.replace(
                            /^refs\/(heads|eigent\/archive)\//,
                            ''
                          )}
                        </span>
                        {branch.archived ? (
                          <span className="rounded-full bg-ds-bg-neutral-strong-default px-2 py-0.5 text-body-xs">
                            archived
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 truncate text-body-xs text-ds-text-neutral-muted-default">
                        {branch.subject || branch.oid.slice(0, 10)} ·{' '}
                        {formatDate(branch.committed_at)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-body-sm font-bold">
                  {t('layout.workspace-recent-commits', {
                    defaultValue: 'Recent checkpoints and commits',
                  })}
                </h3>
                <div className="divide-y divide-ds-border-neutral-default-default rounded-xl border border-ds-border-neutral-default-default">
                  {history.commits.map((commit) => (
                    <div key={commit.oid} className="flex gap-3 px-3 py-2.5">
                      <code className="shrink-0 text-body-xs">
                        {commit.oid.slice(0, 8)}
                      </code>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm">
                          {commit.subject}
                        </p>
                        <p className="truncate text-body-xs text-ds-text-neutral-muted-default">
                          {commit.author} · {formatDate(commit.committed_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
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

              <section className="space-y-2 rounded-xl border border-ds-border-neutral-default-default p-3">
                <div>
                  <h3 className="text-body-sm font-bold">Advanced Git</h3>
                  <p className="text-body-xs text-ds-text-neutral-muted-default">
                    Enter argv as a JSON string array. No shell is used. The
                    exact classified action is reviewed before execution.
                  </p>
                </div>
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
              </section>

              <p className="text-body-xs text-ds-text-neutral-muted-default">
                Automatic archive deletion and object GC are disabled. Encrypted
                Space backup is not configured implicitly and remains a
                separate, explicit product setup.
              </p>
            </>
          ) : null}
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
