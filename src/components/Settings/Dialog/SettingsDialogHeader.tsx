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

import { cn } from '@/lib/utils';
import type { SettingsSectionId } from '@/store/settingsDialogStore';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowLeft, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsHeader } from '../SettingsHeaderContext';
import { getSettingsNavigationItem } from './settingsNavigation';

interface SettingsDialogHeaderProps {
  activeSection: SettingsSectionId;
}

export default function SettingsDialogHeader({
  activeSection,
}: SettingsDialogHeaderProps) {
  const { t } = useTranslation();
  const { headerOverride, setHeaderActionsElement } = useSettingsHeader();
  const item = getSettingsNavigationItem(activeSection);
  const title =
    headerOverride?.title ??
    t(item.labelKey, { defaultValue: item.defaultLabel });

  return (
    <header className="flex h-[44px] shrink-0 items-center gap-2 border-0 bg-ds-bg-neutral-default-default pl-8 pr-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {headerOverride?.onBack ? (
          <>
            <button
              type="button"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-ds-text-neutral-default-default outline-none transition-colors hover:bg-ds-bg-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-border-brand-default-focus"
              aria-label={t('layout.back', { defaultValue: 'Back' })}
              onClick={headerOverride.onBack}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="max-w-52 shrink-0 truncate text-body-md font-bold text-ds-text-neutral-default-default">
              {title}
            </span>
          </>
        ) : headerOverride?.hideTitle ? null : (
          <span className="ml-4 min-w-0 shrink-0 truncate text-body-md font-bold text-ds-text-neutral-default-default">
            {title}
          </span>
        )}

        <div
          ref={setHeaderActionsElement}
          className={cn(
            'flex min-w-0 items-center gap-2 empty:hidden',
            headerOverride?.hideTitle ? 'flex-1' : 'ml-auto'
          )}
        />
      </div>

      <DialogPrimitive.Close asChild>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-ds-icon-neutral-default-default outline-none transition-colors hover:bg-ds-bg-neutral-default-hover focus-visible:ring-2 focus-visible:ring-ds-border-brand-default-focus"
          aria-label={t('layout.close', { defaultValue: 'Close settings' })}
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </DialogPrimitive.Close>
    </header>
  );
}
