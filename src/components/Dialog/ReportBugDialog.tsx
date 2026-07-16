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
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useHost } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const GITHUB_ISSUES_URL = 'https://github.com/eigent-ai/eigent/issues/new';

/** Matches `getDiagnosticsInfo` in preload / `ElectronAPI` */
type DiagnosticsInfo = {
  version: string;
  platform: string;
  arch: string;
};

interface ReportBugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type LogKind = 'eigent' | 'camel';

export default function ReportBugDialog({
  open,
  onOpenChange,
}: ReportBugDialogProps) {
  const host = useHost();
  const { t } = useTranslation();
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);
  const projectStore = useProjectRuntimeStore();
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [meta, setMeta] = useState<DiagnosticsInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [exportingLog, setExportingLog] = useState<LogKind | null>(null);

  const hasElectron = Boolean(host?.electronAPI?.exportDiagnosticsZip);
  const canDownloadLogs = Boolean(host?.electronAPI?.exportLog);

  const handleDownloadLog = useCallback(
    async (kind: LogKind) => {
      const api = host?.electronAPI;
      if (!api || exportingLog) return;
      setExportingLog(kind);
      try {
        let result;
        if (kind === 'eigent') {
          result = await api.exportLog();
        } else {
          // Target the task the user last ran so we grab the right camel_logs.
          const activeProjectId = projectStore.activeProjectId ?? undefined;
          const activeTaskId =
            (activeProjectId
              ? projectStore.peekActiveChatStore(activeProjectId)
              : null
            )?.getState().activeTaskId ?? undefined;
          result = await api.exportCamelLog(
            email,
            activeTaskId,
            activeProjectId,
            userId
          );
        }
        if (result?.success && result.savedPath) {
          toast.success(
            t('layout.support-log-saved', {
              defaultValue: 'Log saved to {{path}}',
              path: result.savedPath,
            })
          );
        } else if (result?.error === 'no log file') {
          toast.error(
            t('layout.support-log-empty', {
              defaultValue: 'No log files found yet.',
            })
          );
        } else if (result?.error) {
          toast.error(
            t('layout.support-log-export-failed', {
              defaultValue: 'Could not export the log.',
            })
          );
        }
        // empty error means the user canceled the save dialog — stay silent
      } catch {
        toast.error(
          t('layout.support-log-export-failed', {
            defaultValue: 'Could not export the log.',
          })
        );
      } finally {
        setExportingLog(null);
      }
    },
    [email, userId, exportingLog, host?.electronAPI, projectStore, t]
  );

  useEffect(() => {
    if (!open) return;
    const api = host?.electronAPI;
    if (!api?.getDiagnosticsInfo) return;
    void api
      .getDiagnosticsInfo()
      .then((info: DiagnosticsInfo) => {
        if (info?.version) {
          setMeta({
            version: info.version,
            platform: info.platform,
            arch: info.arch,
          });
        }
      })
      .catch(() => setMeta(null));
  }, [open, host?.electronAPI]);

  useEffect(() => {
    if (!open) {
      setDescription('');
      setSteps('');
    }
  }, [open]);

  const onSubmit = useCallback(async () => {
    const trimmed = description.trim();
    if (!trimmed) {
      toast.error(t('layout.report-bug-description-required'));
      return;
    }

    const bodyParts: string[] = [trimmed];
    if (steps.trim()) {
      bodyParts.push(`\n**Steps to reproduce:**\n${steps.trim()}`);
    }
    if (meta) {
      bodyParts.push(
        `\n**Environment:** v${meta.version} · ${meta.platform} · ${meta.arch}`
      );
    }
    if (hasElectron) {
      bodyParts.push('\n*Diagnostics zip attached.*');
    }

    const url =
      GITHUB_ISSUES_URL +
      '?title=' +
      encodeURIComponent(
        t('layout.report-bug-dialog-title', { defaultValue: 'Bug Report' })
      ) +
      '&body=' +
      encodeURIComponent(bodyParts.join('\n'));

    setSubmitting(true);
    try {
      // Export diagnostics zip first (Electron only) — shows a native save dialog
      const api = host?.electronAPI;
      if (api?.exportDiagnosticsZip) {
        const result = await api.exportDiagnosticsZip({
          description: trimmed,
          steps: steps.trim() || undefined,
        });
        if (result?.success && result.savedPath) {
          toast.success(
            t('layout.report-bug-zip-saved', {
              defaultValue:
                'Diagnostics saved — attach the zip file to the GitHub issue.',
            })
          );
        }
      }

      window.open(url, '_blank', 'noopener,noreferrer');
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [
    description,
    steps,
    meta,
    hasElectron,
    host?.electronAPI,
    onOpenChange,
    t,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        className="gap-0 !rounded-xl border border-ds-border-neutral-strong-default !bg-ds-bg-neutral-strong-default p-0 shadow-sm sm:max-w-[560px]"
      >
        <div className="w-full rounded-t-xl bg-ds-bg-neutral-strong-default pb-2 pl-md pr-12 pt-md text-left">
          <DialogTitle className="m-0 block w-full text-left text-body-md font-bold text-ds-text-neutral-default-default">
            {t('layout.support', { defaultValue: 'Support' })}
          </DialogTitle>
        </div>
        <div className="flex max-h-[min(70vh,520px)] flex-col gap-md bg-ds-bg-neutral-strong-default px-md pb-md pt-2 text-left">
          {meta && (
            <p className="m-0 text-body-sm text-ds-text-neutral-subtle-default">
              {t('layout.report-bug-meta', {
                version: meta.version,
                os: meta.platform,
                arch: meta.arch,
              })}
            </p>
          )}
          <h3 className="m-0 text-body-sm font-bold text-ds-text-neutral-default-default">
            {t('layout.report-bug-dialog-title', {
              defaultValue: 'Report a bug',
            })}
          </h3>
          <label
            className="text-body-sm font-medium text-ds-text-neutral-default-default"
            htmlFor="report-bug-description"
          >
            {t('layout.report-bug-field-description')}
          </label>
          <Textarea
            id="report-bug-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('layout.report-bug-field-description-placeholder')}
            className="min-h-[88px] resize-y"
          />
          <label
            className="text-body-sm font-medium text-ds-text-neutral-default-default"
            htmlFor="report-bug-steps"
          >
            {t('layout.report-bug-field-steps')}
          </label>
          <Textarea
            id="report-bug-steps"
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={t('layout.report-bug-field-steps-placeholder')}
            className="min-h-[72px] resize-y"
          />
          {canDownloadLogs && (
            <div className="mt-1 flex flex-col gap-sm border-0 border-t border-solid border-ds-border-neutral-subtle-default pt-md">
              <h3 className="m-0 text-body-sm font-bold text-ds-text-neutral-default-default">
                {t('layout.support-logs-heading', {
                  defaultValue: 'Download logs',
                })}
              </h3>
              <div className="flex items-center justify-between gap-md">
                <div className="flex min-w-0 flex-col">
                  <span className="text-body-sm font-medium text-ds-text-neutral-default-default">
                    {t('layout.support-eigent-log', {
                      defaultValue: 'Eigent log',
                    })}
                  </span>
                  <span className="text-body-xs text-ds-text-neutral-subtle-default">
                    {t('layout.support-eigent-log-desc', {
                      defaultValue: 'Desktop app logs',
                    })}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => void handleDownloadLog('eigent')}
                  disabled={exportingLog !== null}
                  aria-label={t('layout.support-eigent-log', {
                    defaultValue: 'Eigent log',
                  })}
                >
                  {exportingLog === 'eigent' ? (
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Download className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  {t('layout.support-download', { defaultValue: 'Download' })}
                </Button>
              </div>
              {Boolean(host?.electronAPI?.exportCamelLog) && (
                <div className="flex items-center justify-between gap-md">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-body-sm font-medium text-ds-text-neutral-default-default">
                      {t('layout.support-camel-log', {
                        defaultValue: 'Camel log',
                      })}
                    </span>
                    <span className="text-body-xs text-ds-text-neutral-subtle-default">
                      {t('layout.support-camel-log-desc', {
                        defaultValue: 'Agent task logs (CAMEL backend)',
                      })}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() => void handleDownloadLog('camel')}
                    disabled={exportingLog !== null || !email}
                    aria-label={t('layout.support-camel-log', {
                      defaultValue: 'Camel log',
                    })}
                  >
                    {exportingLog === 'camel' ? (
                      <Loader2
                        className="h-4 w-4 shrink-0 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <Download className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    {t('layout.support-download', { defaultValue: 'Download' })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex !flex-col gap-sm !rounded-b-xl !border-0 !border-t-0 bg-transparent p-md shadow-none sm:!flex-col">
          {hasElectron && (
            <p className="m-0 w-full text-right text-body-xs text-ds-text-neutral-subtle-default">
              {t('layout.report-bug-zip-hint', {
                defaultValue:
                  'A diagnostics zip will be saved — attach it to the issue.',
              })}
            </p>
          )}
          <div className="flex w-full flex-row justify-end gap-sm">
            <Button
              variant="ghost"
              size="md"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('layout.cancel')}
            </Button>
            <Button
              size="md"
              variant="primary"
              onClick={() => void onSubmit()}
              disabled={!description.trim() || submitting}
            >
              {submitting ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin"
                  aria-hidden
                />
              ) : (
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              )}
              {t('layout.report-bug-open-github', {
                defaultValue: 'Open on GitHub',
              })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
