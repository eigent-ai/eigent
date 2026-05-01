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
import { Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const INFO_EMAIL = 'info@eigent.ai';

function buildMailtoUrl(
  subject: string,
  body: string
): { url: string; truncated: boolean } {
  const maxLen = 1800;
  const tail = '\n\n[…]';
  let b = body;
  let truncated = false;
  if (b.length > maxLen) {
    b = b.slice(0, maxLen - tail.length) + tail;
    truncated = true;
  }
  const url = `mailto:${INFO_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(b)}`;
  return { url, truncated };
}

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
  const [downloadingLog, setDownloadingLog] = useState(false);

  const handleDownloadLog = useCallback(async () => {
    const exportLog = host?.electronAPI?.exportLog;
    if (!exportLog) {
      toast.error(t('layout.general-error'));
      return;
    }
    setDownloadingLog(true);
    try {
      const response = await exportLog();
      if (!response?.success) {
        if (response?.error) {
          toast.error(response.error);
        }
        return;
      }
      if (response.savedPath) {
        toast.success(`${t('layout.log-saved')} ${response.savedPath}`);
        return;
      }
      if (response.data === 'log file is empty') {
        toast.info(t('layout.log-file-empty'));
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('layout.general-error'));
    } finally {
      setDownloadingLog(false);
    }
  }, [host?.electronAPI, t]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const api = host?.electronAPI;
    if (!api?.getDiagnosticsInfo) {
      return;
    }
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
      .catch(() => {
        setMeta(null);
      });
  }, [open, host?.electronAPI]);

  useEffect(() => {
    if (!open) {
      setDescription('');
      setSteps('');
    }
  }, [open]);

  const onSubmit = useCallback(async () => {
    const api = host?.electronAPI;
    if (!api?.exportDiagnosticsZip || !api?.openMailto) {
      toast.error(t('layout.general-error'));
      return;
    }
    const trimmed = description.trim();
    if (!trimmed) {
      toast.error(t('layout.report-bug-description-required'));
      return;
    }
    setSubmitting(true);
    try {
      const response = await api.exportDiagnosticsZip({
        description: trimmed,
        steps: steps.trim() || undefined,
      });
      if (!response?.success) {
        if (response?.error === '') {
          return;
        }
        if (response?.error) {
          toast.error(response.error);
        } else {
          toast.error(t('layout.general-error'));
        }
        return;
      }
      if (!response.savedPath) {
        return;
      }

      const subject = t('layout.report-bug-mail-subject');
      const v = meta?.version ?? '—';
      const p = meta?.platform ?? '—';
      const a = meta?.arch ?? '—';
      const body = [
        t('layout.report-bug-mail-body-intro'),
        '',
        t('layout.report-bug-mail-body-path', { path: response.savedPath }),
        '',
        '—',
        t('layout.report-bug-mail-body-meta', { version: v, os: p, arch: a }),
        '',
        t('layout.report-bug-mail-body-desc'),
        trimmed,
        '',
        ...(steps.trim()
          ? [t('layout.report-bug-mail-body-steps'), steps.trim(), '']
          : []),
      ].join('\n');

      const { url, truncated } = buildMailtoUrl(subject, body);
      if (truncated) {
        toast.info(t('layout.report-bug-mail-body-truncated'));
      }

      const mail = await api.openMailto(url);
      if (!mail?.success) {
        if (mail?.error) {
          toast.error(mail.error);
        }
        return;
      }
      onOpenChange(false);
      toast.success(t('layout.report-bug-diagnostics-saved'));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : t('layout.general-error'));
    } finally {
      setSubmitting(false);
    }
  }, [host?.electronAPI, description, steps, meta, onOpenChange, t]);

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
          <p className="text-body-sm text-ds-text-neutral-subtle-default m-0">
            {t('layout.report-bug-footer-hint')}
          </p>
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
            disabled={submitting}
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
            disabled={submitting}
          />
          <div className="pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="text"
              onClick={() => void handleDownloadLog()}
              disabled={submitting || downloadingLog}
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              {t('layout.download-logs')}
            </Button>
          </div>
        </div>
        <DialogFooter className="!rounded-b-xl p-md gap-sm sm:!flex-col flex !flex-col !border-0 !border-t-0 bg-transparent shadow-none">
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
              disabled={submitting || !description.trim()}
            >
              {t('layout.report-bug-submit')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
