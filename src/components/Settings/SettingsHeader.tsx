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

import ContentHeader from '@/components/Layout/ContentHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { SettingsSectionId } from '@/store/settingsStore';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsHeader } from './SettingsHeaderContext';
import { getSettingsNavigationItem } from './settingsNavigation';

interface SettingsHeaderProps {
  activeSection: SettingsSectionId;
}

/**
 * Settings content-pane header. Same 44px row as the other pages; sections
 * still push their own title/back/actions through `SettingsHeaderContext`.
 */
export default function SettingsHeader({ activeSection }: SettingsHeaderProps) {
  const { t } = useTranslation();
  const { headerOverride, setHeaderActionsElement } = useSettingsHeader();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const item = getSettingsNavigationItem(activeSection);
  const title =
    headerOverride?.title ??
    t(item.labelKey, { defaultValue: item.defaultLabel });
  const backLabel = t('layout.back', { defaultValue: 'Back' });

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <ContentHeader>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {headerOverride?.onBack ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className="shrink-0 rounded-lg"
              aria-label={backLabel}
              onClick={headerOverride.onBack}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
            </Button>
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="max-w-52 shrink-0 truncate text-ds-text-body-large font-bold text-ds-ink-default-default outline-none"
            >
              {title}
            </h1>
          </>
        ) : (
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={
              headerOverride?.hideTitle
                ? 'sr-only outline-none'
                : 'min-w-0 shrink-0 truncate px-1 text-ds-text-body-large font-bold text-ds-ink-default-default outline-none'
            }
          >
            {title}
          </h1>
        )}

        <div
          ref={setHeaderActionsElement}
          className={cn(
            'flex min-w-0 items-center gap-2 empty:hidden',
            headerOverride?.hideTitle ? 'flex-1' : 'ml-auto'
          )}
        />
      </div>
    </ContentHeader>
  );
}
