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

import { TOP_BAR_CONTROL_STATE_CLASS } from '@/components/TopBar/controlStyles';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { useSpaceStore } from '@/store/spaceStore';
import { AppWindow, Folder, Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Title bar of a Session window: the main window's bar with only the Space
 * name and one action that hands the Session back to the main window.
 */
export function SessionWindowTopBar({
  spaceId,
  onOpenInMainWindow,
}: {
  spaceId: string;
  onOpenInMainWindow: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const [platform, setPlatform] = useState('');
  const spaceName = useSpaceStore((s) => s.spaces[spaceId]?.name);
  const spaceTitle = getActiveSpaceTriggerLabel(spaceName, t);
  const openInMainLabel = t('layout.open-in-main-window', {
    defaultValue: 'Open in main window',
  });

  useEffect(() => {
    if (!host?.electronAPI?.getPlatform) return;
    setPlatform(host.electronAPI.getPlatform());
  }, [host]);

  // Same insets as the main title bar, so the macOS traffic lights line up.
  const leadingInset = platform === 'darwin' ? 68 : 8;

  return (
    <div
      className={cn(
        'drag absolute top-0 right-0 left-0 z-50 flex !h-10 min-w-0 items-center py-1',
        platform === 'darwin' && 'pr-2'
      )}
      style={{ paddingLeft: leadingInset }}
      id="titlebar"
    >
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-between">
        <div className="ml-1.5 flex min-h-[28px] min-w-0 items-center gap-1.5 px-2 text-ds-text-base font-bold text-ds-ink-default-default">
          <DsIcon icon={Folder} className="shrink-0" aria-hidden />
          <span className="min-w-0 truncate" title={spaceTitle}>
            {spaceTitle}
          </span>
        </div>
        <div className="no-drag relative z-50 flex h-7 shrink-0 items-center gap-0.5">
          <TooltipSimple
            content={openInMainLabel}
            side="bottom"
            align="end"
            variant="instant"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              className={cn(
                'no-drag rounded-full',
                TOP_BAR_CONTROL_STATE_CLASS
              )}
              aria-label={openInMainLabel}
              onClick={onOpenInMainWindow}
            >
              <DsIcon icon={AppWindow} aria-hidden />
            </Button>
          </TooltipSimple>
        </div>
      </div>

      {/* Linux uses the in-app window controls; macOS and Windows use native chrome. */}
      {platform === 'linux' && (
        <div className="no-drag flex h-full items-center" id="window-controls">
          <button
            type="button"
            aria-label={t('layout.minimize', { defaultValue: 'Minimize' })}
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center border-0 border-x-0 border-y-0 bg-transparent p-0 text-center leading-5 text-inherit hover:bg-ds-neutral-subtle-default"
            onClick={() => host?.electronAPI?.minimizeWindow()}
          >
            <DsIcon icon={Minus} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('layout.maximize', { defaultValue: 'Maximize' })}
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center border-0 border-x-0 border-y-0 bg-transparent p-0 text-center leading-5 text-inherit hover:bg-ds-neutral-subtle-default"
            onClick={() => host?.electronAPI?.toggleMaximizeWindow()}
          >
            <DsIcon icon={Square} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('layout.close', { defaultValue: 'Close' })}
            className="flex h-full w-[35px] flex-1 cursor-pointer items-center justify-center border-0 border-x-0 border-y-0 bg-transparent p-0 text-center leading-5 text-inherit hover:bg-ds-neutral-subtle-default"
            // Closes this Session window only; quitting stays with the main window.
            onClick={() => window.close()}
          >
            <DsIcon icon={X} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
