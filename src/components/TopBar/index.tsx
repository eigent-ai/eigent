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

import { useAppCommand } from '@/components/Layout/AppCommandProvider';
import { TOP_BAR_CONTROL_STATE_CLASS } from '@/components/TopBar/controlStyles';
import { TopBarPrimaryNavigation } from '@/components/TopBar/TopBarPrimaryNavigation';
import UpdateButton from '@/components/TopBar/UpdateButton';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useShellHistory } from '@/hooks/useShellHistory';
import { useWorkspaceSavePoint } from '@/hooks/useWorkspaceSavePoint';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { APP_COMMAND } from '@/shared/appCommands';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Minus,
  PanelLeft,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

function HeaderWin() {
  const { t } = useTranslation();
  const host = useHost();
  const titlebarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const executeAppCommand = useAppCommand();
  const { canGoBack, canGoForward, goBack, goForward } = useShellHistory();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const workspaceSidebarHidden = usePageTabStore(
    (s) => s.workspaceSidebarHidden
  );
  const toggleWorkspaceSidebar = usePageTabStore(
    (s) => s.toggleWorkspaceSidebar
  );
  const email = useAuthStore((s) => s.email);
  const userId = useAuthStore((s) => s.user_id);

  useEffect(() => {
    if (!host?.electronAPI?.getPlatform) return;
    const p = host.electronAPI.getPlatform();
    setPlatform(p);
  }, [host]);

  const topBarLeadingInset = platform === 'darwin' ? 68 : 8;

  const sidebarToggleLabel = workspaceSidebarHidden
    ? t('layout.show-sidebar', { defaultValue: 'Show sidebar' })
    : t('layout.hide-sidebar', { defaultValue: 'Hide sidebar' });

  // The Space menu lives on the Workspace page now; the save shortcut stays
  // here because the top bar is always mounted.
  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const versionHistory = useWorkspaceSavePoint({
    spaceId: activeSpaceId,
    space: activeSpace,
    email,
    userId,
    shortcut: true,
  });

  return (
    <div
      className={cn(
        'drag absolute top-0 right-0 left-0 z-50 flex !h-10 min-w-0 items-center py-1',
        platform === 'darwin' && 'pr-2'
      )}
      style={{ paddingLeft: topBarLeadingInset }}
      id="titlebar"
      ref={titlebarRef}
    >
      <AlertDialog
        isOpen={versionHistory.enableConfirmOpen}
        onClose={() => versionHistory.setEnableConfirmOpen(false)}
        onConfirm={() => {
          versionHistory.setEnableConfirmOpen(false);
          void versionHistory.enable(true);
        }}
        title={t('layout.workspace-version-enable-title')}
        message={t('layout.workspace-version-enable-message')}
        confirmText={t('layout.workspace-enable-version-history')}
        cancelText={t('layout.cancel')}
        confirmVariant="primary"
      />
      {/* Two-sided global navigation: destinations on the left, utilities on the right. */}
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-between">
        <TopBarPrimaryNavigation
          sidebarHidden={workspaceSidebarHidden}
          leadingInset={topBarLeadingInset}
          sidebarControls={
            <>
              <TooltipSimple
                content={
                  <ShortcutTooltipContent
                    label={sidebarToggleLabel}
                    shortcutId="toggle-workspace-sidebar"
                  />
                }
                compact
                side="bottom"
                align="center"
                variant="instant"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  className={cn(
                    'no-drag rounded-full',
                    TOP_BAR_CONTROL_STATE_CLASS,
                    'aria-pressed:!bg-transparent'
                  )}
                  onClick={toggleWorkspaceSidebar}
                  aria-pressed={!workspaceSidebarHidden}
                  aria-label={sidebarToggleLabel}
                >
                  {workspaceSidebarHidden ? (
                    <DsIcon icon={PanelLeftOpen} aria-hidden />
                  ) : (
                    <DsIcon icon={PanelLeft} aria-hidden />
                  )}
                </Button>
              </TooltipSimple>
              <div className="flex shrink-0 items-center gap-0.5">
                <TooltipSimple
                  content={t('layout.back')}
                  compact
                  side="bottom"
                  align="center"
                  variant="instant"
                >
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className={cn(
                        'no-drag rounded-full',
                        TOP_BAR_CONTROL_STATE_CLASS
                      )}
                      disabled={!canGoBack}
                      onClick={goBack}
                      aria-label={t('layout.back')}
                    >
                      <DsIcon icon={ArrowLeft} aria-hidden />
                    </Button>
                  </span>
                </TooltipSimple>
                <TooltipSimple
                  content={t('layout.forward')}
                  compact
                  side="bottom"
                  align="center"
                  variant="instant"
                >
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      buttonContent="icon-only"
                      className={cn(
                        'no-drag rounded-full',
                        TOP_BAR_CONTROL_STATE_CLASS
                      )}
                      disabled={!canGoForward}
                      onClick={goForward}
                      aria-label={t('layout.forward')}
                    >
                      <DsIcon icon={ArrowRight} aria-hidden />
                    </Button>
                  </span>
                </TooltipSimple>
              </div>
            </>
          }
          contentControls={null}
        />

        <div
          className={cn(
            'no-drag relative z-50 flex h-7 shrink-0 items-center gap-0.5',
            platform === 'darwin' && 'px-0'
          )}
        >
          <UpdateButton />
          <TooltipSimple
            content={t('layout.support')}
            side="bottom"
            align="center"
            variant="instant"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                'no-drag rounded-full',
                TOP_BAR_CONTROL_STATE_CLASS
              )}
              aria-label={t('layout.support')}
              onClick={() => executeAppCommand(APP_COMMAND.reportBug)}
              buttonContent="icon-only"
            >
              <DsIcon icon={CircleHelp} aria-hidden />
            </Button>
          </TooltipSimple>
        </div>
      </div>

      {/* Linux uses the in-app window controls; macOS and Windows use native chrome. */}
      {platform === 'linux' && (
        <div
          className="no-drag flex h-full items-center"
          id="window-controls"
          ref={controlsRef}
        >
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
            onClick={() => host?.electronAPI?.closeWindow(false)}
          >
            <DsIcon icon={X} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

export default HeaderWin;
