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
          <p className="text-ds-text-neutral-muted-default text-body-sm mt-3">
            {t('layout.notifications-empty')}
          </p>
        </div>
      </div>
    </>
  );
}
