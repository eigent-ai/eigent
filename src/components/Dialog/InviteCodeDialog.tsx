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

import { proxyFetchGet } from '@/api/http';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface InviteCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function InviteCodeDialog({
  open,
  onOpenChange,
}: InviteCodeDialogProps) {
  const { t } = useTranslation();
  const cachedCodeRef = useRef<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }

    if (cachedCodeRef.current) {
      setInviteCode(cachedCodeRef.current);
      setLoading(false);
      void navigator.clipboard.writeText(cachedCodeRef.current);
      return;
    }

    let cancelled = false;
    setInviteCode(null);
    setLoading(true);

    void proxyFetchGet('/api/v1/user/invite_code')
      .then(async (res: { invite_code?: string }) => {
        if (cancelled) return;
        if (res?.invite_code) {
          cachedCodeRef.current = res.invite_code;
          setInviteCode(res.invite_code);
          await navigator.clipboard.writeText(res.invite_code);
        } else {
          toast.error(t('layout.failed-to-get-invite-code'));
          onOpenChange(false);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to get referral link:', error);
        toast.error(t('layout.failed-to-get-invitation-link'));
        onOpenChange(false);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, onOpenChange, t]);

  const handleCopyCode = useCallback(async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard may be unavailable */
    }
  }, [inviteCode]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        overlayClassName="pointer-events-none invisible backdrop-blur-none"
        className="min-h-[360px] gap-0 !rounded-xl border border-ds-border-neutral-strong-default !bg-ds-bg-neutral-strong-default p-0 shadow-sm sm:max-w-[360px]"
      >
        <div className="mt-10 flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-md bg-ds-bg-neutral-strong-default px-md pb-md pt-2 text-center">
          <span className="m-0 text-heading-sm font-bold text-ds-text-neutral-default-default">
            {t('layout.invitation-code-copied-title')}
          </span>
          <span className="m-0 max-w-60 text-body-sm text-ds-text-neutral-subtle-default">
            {t('layout.invitation-code-copied-description')}
          </span>
          <div className="flex h-full min-h-40 w-full flex-1 flex-col items-center justify-center gap-4">
            {loading ? (
              <LoaderCircle
                className="h-8 w-8 animate-spin text-ds-icon-neutral-muted-default"
                aria-label={t('layout.loading', { defaultValue: 'Loading' })}
              />
            ) : (
              inviteCode && (
                <div className="flex flex-col items-center justify-center gap-4 rounded-2xl bg-ds-bg-neutral-subtle-default px-8 py-4">
                  <p
                    className="m-0 font-mono text-heading-base font-bold tracking-wide text-ds-text-brand-muted-default"
                    aria-label={t('layout.invitation-code-label')}
                  >
                    {inviteCode}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleCopyCode()}
                  >
                    {copied ? (
                      <Check className="h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                      <Copy className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    {copied
                      ? t('layout.invitation-code-copy-success')
                      : t('layout.copy-code')}
                  </Button>
                </div>
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
