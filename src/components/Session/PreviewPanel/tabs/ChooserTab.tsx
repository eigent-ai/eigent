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
import type { PreviewTabKind } from '@/store/pageTabStore';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PREVIEW_TAB_KINDS } from '../tabKinds';

export interface ChooserTabProps {
  /** Open the given content kind (replaces this chooser tab in place). */
  onChoose: (kind: PreviewTabKind) => void;
}

/**
 * The default starter tab. Lists every content kind as a vertical row; picking
 * one turns this tab into that kind via the store's `choosePreviewTabType`.
 */
export function ChooserTab({ onChoose }: ChooserTabProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-y-auto p-4">
      <div className="w-full max-w-[420px]">
        <p className="mb-3 px-1 text-sm font-medium text-ds-text-neutral-muted-default">
          {t('layout.preview-chooser-title', {
            defaultValue: 'Open a new view',
          })}
        </p>
        <div className="flex flex-col gap-1.5">
          {PREVIEW_TAB_KINDS.map(
            ({
              kind,
              icon: Icon,
              labelKey,
              defaultLabel,
              descriptionKey,
              defaultDescription,
            }) => (
              <button
                key={kind}
                type="button"
                onClick={() => onChoose(kind)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-xl border-solid border-transparent bg-ds-bg-neutral-default-default px-3 py-2.5 text-left transition-colors',
                  'hover:border-ds-border-neutral-default-default hover:bg-ds-bg-neutral-default-hover'
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ds-bg-neutral-subtle-default text-ds-text-neutral-default-default">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-medium text-ds-text-neutral-default-default">
                    {t(labelKey, { defaultValue: defaultLabel })}
                  </span>
                  <span className="truncate text-xs text-ds-text-neutral-muted-default">
                    {t(descriptionKey, { defaultValue: defaultDescription })}
                  </span>
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-ds-text-neutral-muted-default opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden
                />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default ChooserTab;
