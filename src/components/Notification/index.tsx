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

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export type NotificationPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[99] cursor-default bg-transparent backdrop-blur-[1px]"
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
        className="fixed bottom-3 right-3 top-12 z-[100] flex min-h-0 w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border-[0.5px] border-solid border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default duration-200 ease-out animate-in fade-in-0 slide-in-from-right-2"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-3 pl-3 pr-1.5">
          <span
            id="notification-panel-heading"
            className="shrink-0 text-body-md font-bold text-ds-text-neutral-default-default"
          >
            {t('layout.notifications')}
          </span>
          <p className="mt-3 text-body-sm text-ds-text-neutral-muted-default">
            {t('layout.notifications-empty')}
          </p>
        </div>
      </div>
    </>,
    document.body
  );
}
