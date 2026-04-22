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
import { AlertCircle, Bell, Sparkles, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type NotificationPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type NotificationItemCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional action row (e.g. buttons) */
  actions?: ReactNode;
};

function NotificationItemCard({
  icon: Icon,
  title,
  description,
  actions,
}: NotificationItemCardProps) {
  return (
    <div className="rounded-xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default p-3 border border-solid">
      <div className="gap-3 min-w-0 flex items-start">
        <div
          className="text-ds-icon-neutral-default-default h-4 w-4 rounded-lg flex shrink-0 items-center justify-center"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 gap-1.5 flex flex-1 flex-col">
          <span className="text-ds-text-neutral-default-default text-body-sm font-semibold leading-tight">
            {title}
          </span>
          <span className="text-ds-text-neutral-muted-default text-body-xs leading-tight mt-1">
            {description}
          </span>
          {actions != null ? (
            <div className="gap-2 mt-1 flex flex-wrap items-center">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function NotificationPanel({
  open,
  onOpenChange,
}: NotificationPanelProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="inset-0 fixed z-40 cursor-default bg-transparent backdrop-blur-[1px]"
        aria-label={t('layout.notification-panel-dismiss', {
          defaultValue: 'Dismiss',
        })}
        onClick={() => onOpenChange(false)}
      />
      <div
        id="notification-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-panel-heading"
        className="right-2 top-10 bottom-2 min-h-0 ease-out animate-in fade-in-0 slide-in-from-right-2 rounded-2xl bg-ds-bg-neutral-default-default fixed z-50 flex w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden duration-200"
      >
        <div className="min-h-0 pl-3 pr-1.5 py-3 flex flex-1 flex-col overflow-y-auto">
          <span
            id="notification-panel-heading"
            className="text-ds-text-neutral-default-default text-body-md font-bold shrink-0"
          >
            {t('layout.notifications')}
          </span>
          <div className="mt-3 min-h-0 gap-2.5 flex flex-col">
            <NotificationItemCard
              icon={Sparkles}
              title={t('layout.notification-placeholder-feature-title', {
                defaultValue: 'New: workspace shortcuts',
              })}
              description={t(
                'layout.notification-placeholder-feature-description',
                {
                  defaultValue:
                    'You can now jump between session and workforce from the command palette.',
                }
              )}
              actions={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    tone="neutral"
                    size="xs"
                    buttonContent="text"
                  >
                    {t('layout.notification-placeholder-learn-more', {
                      defaultValue: 'Learn more',
                    })}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    tone="neutral"
                    size="xs"
                    buttonContent="text"
                  >
                    {t('layout.notification-placeholder-dismiss', {
                      defaultValue: 'Dismiss',
                    })}
                  </Button>
                </>
              }
            />
            <NotificationItemCard
              icon={AlertCircle}
              title={t('layout.notification-placeholder-sync-title', {
                defaultValue: 'Connection paused',
              })}
              description={t(
                'layout.notification-placeholder-sync-description',
                {
                  defaultValue:
                    'We will retry in the background. You can still work locally.',
                }
              )}
              actions={
                <Button
                  type="button"
                  variant="secondary"
                  tone="neutral"
                  size="xs"
                  buttonContent="text"
                >
                  {t('layout.notification-placeholder-retry', {
                    defaultValue: 'Retry',
                  })}
                </Button>
              }
            />
            <NotificationItemCard
              icon={Bell}
              title={t('layout.notification-placeholder-silent-title', {
                defaultValue: 'All caught up',
              })}
              description={t(
                'layout.notification-placeholder-silent-description',
                {
                  defaultValue:
                    'This item has no action row, only title and message.',
                }
              )}
            />
          </div>
        </div>
      </div>
    </>
  );
}
