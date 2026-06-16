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
import { ExternalLink, Loader2 } from 'lucide-react';
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

export default function ReportBugDialog({
  open,
  onOpenChange,
}: ReportBugDialogProps) {
  const host = useHost();
  const { t } = useTranslation();
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [meta, setMeta] = useState<DiagnosticsInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const hasElectron = Boolean(host?.electronAPI?.exportDiagnosticsZip);

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
        className="gap-0 !rounded-xl border-ds-border-neutral-strong-default !bg-ds-bg-neutral-strong-default p-0 shadow-sm sm:max-w-[560px] border"
      >
        <div className="bg-ds-bg-neutral-strong-default rounded-t-xl pl-md pr-12 pt-md pb-2 w-full text-left">
          <DialogTitle className="m-0 text-body-md font-bold text-ds-text-neutral-default-default block w-full text-left">
            {t('layout.report-bug-dialog-title')}
          </DialogTitle>
        </div>
        <div className="gap-md bg-ds-bg-neutral-strong-default px-md pt-2 pb-md flex max-h-[min(70vh,520px)] flex-col text-left">
          {meta && (
            <p className="text-body-sm text-ds-text-neutral-subtle-default m-0">
              {t('layout.report-bug-meta', {
                version: meta.version,
                os: meta.platform,
                arch: meta.arch,
              })}
            </p>
          )}
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
        </div>
        <DialogFooter className="!rounded-b-xl p-md gap-sm sm:!flex-col flex !flex-col !border-0 !border-t-0 bg-transparent shadow-none">
          {hasElectron && (
            <p className="text-body-xs text-ds-text-neutral-subtle-default m-0 w-full text-right">
              {t('layout.report-bug-zip-hint', {
                defaultValue:
                  'A diagnostics zip will be saved — attach it to the issue.',
              })}
            </p>
          )}
          <div className="gap-sm flex w-full flex-row justify-end">
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
                  className="h-4 w-4 animate-spin shrink-0"
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
