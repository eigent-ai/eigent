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
import {
  pinSpaceOrChoose,
  usePinnedSpaceIds,
} from '@/components/Layout/AppRail/pinnedSpaces';
import {
  canRenameSpace,
  SpaceRenameDialog,
} from '@/components/SpaceSidebar/SpaceRenameDialog';
import { SpaceSwitchDropdown } from '@/components/SpaceSidebar/SpaceSwitchDropdown';
import {
  TOP_BAR_CONTROL_STATE_CLASS,
  TOP_BAR_PILL_CLASS,
} from '@/components/TopBar/controlStyles';
import { TopBarPrimaryNavigation } from '@/components/TopBar/TopBarPrimaryNavigation';
import UpdateButton from '@/components/TopBar/UpdateButton';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { ShortcutTooltipContent } from '@/components/ui/shortcut-tooltip';
import { TooltipSimple } from '@/components/ui/tooltip';
import { WorkspaceVersionHistoryDialog } from '@/components/Workspace/WorkspaceVersionHistoryDialog';
import { useOpenSpaceHomeTab } from '@/hooks/useSpaceSwitch';
import { useWorkspaceSavePoint } from '@/hooks/useWorkspaceSavePoint';
import { useHost } from '@/host';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import { APP_COMMAND } from '@/shared/appCommands';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  ChevronDown,
  CircleHelp,
  Folder,
  Minus,
  PanelLeft,
  PanelLeftOpen,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

function HeaderWin() {
  const { t } = useTranslation();
  const host = useHost();
  const titlebarRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('');
  const location = useLocation();
  const executeAppCommand = useAppCommand();
  const openSpaceHomeTab = useOpenSpaceHomeTab();
  const [renameSpaceId, setRenameSpaceId] = useState<string | null>(null);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spacesById = useSpaceStore((s) => s.spaces);
  const unpinSpace = useSpaceStore((s) => s.unpinSpace);
  const pinnedSpaceIds = usePinnedSpaceIds();
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

  const isWorkspacePage = location.pathname === '/';
  const topBarLeadingInset = platform === 'darwin' ? 68 : 8;

  const sidebarToggleLabel = workspaceSidebarHidden
    ? t('layout.show-sidebar', { defaultValue: 'Show sidebar' })
    : t('layout.hide-sidebar', { defaultValue: 'Hide sidebar' });

  const activeSpaceTitle = useMemo(
    () =>
      getActiveSpaceTriggerLabel(
        activeSpaceId ? spacesById[activeSpaceId]?.name : undefined,
        t,
        {
          emptyLabelKey: activeSpaceId
            ? 'layout.spaces-untitled'
            : 'layout.spaces-select-space',
        }
      ),
    [activeSpaceId, spacesById, t]
  );

  const activeSpace = activeSpaceId ? spacesById[activeSpaceId] : null;
  const versionHistory = useWorkspaceSavePoint({
    spaceId: activeSpaceId,
    space: activeSpace,
    email,
    userId,
    shortcut: true,
  });
  const canRenameActiveSpace = canRenameSpace(activeSpace);
  const activeSpacePinned = Boolean(
    activeSpaceId && pinnedSpaceIds.includes(activeSpaceId)
  );

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
      <WorkspaceVersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        spaceId={activeSpaceId}
        email={email}
        userId={userId}
        actorId={userId == null ? email || 'local-user' : String(userId)}
      />
      <SpaceRenameDialog
        spaceId={renameSpaceId}
        onClose={() => setRenameSpaceId(null)}
      />
      {/* Two-sided global navigation: destinations on the left, utilities on the right. */}
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-between">
        <TopBarPrimaryNavigation
          sidebarHidden={workspaceSidebarHidden}
          leadingInset={topBarLeadingInset}
          sidebarControls={
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
          }
          contentControls={
            isWorkspacePage ? (
              <SpaceSwitchDropdown
                contentSideOffset={6}
                onOpenChange={(open) => {
                  if (open && versionHistory.supported) {
                    void versionHistory.loadStatus();
                  }
                }}
                trigger={
                  <button
                    id="active-space-title-btn"
                    type="button"
                    className={TOP_BAR_PILL_CLASS}
                    aria-haspopup="menu"
                    aria-label={activeSpaceTitle}
                  >
                    <DsIcon icon={Folder} className="shrink-0" aria-hidden />
                    <span className="max-w-[220px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                      {activeSpaceTitle}
                    </span>
                    <DsIcon
                      icon={ChevronDown}
                      className="shrink-0 text-ds-ink-subtle-default"
                      aria-hidden
                    />
                  </button>
                }
                activeSpaceId={activeSpaceId}
                canRenameActiveSpace={canRenameActiveSpace}
                onRenameSpace={() => {
                  if (canRenameActiveSpace) setRenameSpaceId(activeSpaceId);
                }}
                onOpenSpaceSettings={() => {
                  if (activeSpaceId) {
                    openSpaceHomeTab(activeSpaceId, 'workspace-profile');
                  }
                }}
                onOpenMemorySettings={() => {
                  if (activeSpaceId) openSpaceHomeTab(activeSpaceId, 'memory');
                }}
                pinMenu={
                  activeSpaceId
                    ? {
                        pinned: activeSpacePinned,
                        onToggle: () => {
                          if (activeSpacePinned) unpinSpace(activeSpaceId);
                          else pinSpaceOrChoose(activeSpaceId);
                        },
                      }
                    : undefined
                }
                contentAlign="start"
                triggerWrapperClassName="min-w-0 overflow-hidden rounded-full"
                savePointMenu={
                  versionHistory.supported
                    ? {
                        loading:
                          versionHistory.loading ||
                          versionHistory.status === null,
                        saving: versionHistory.saving,
                        enabled: versionHistory.status?.enabled === true,
                        needsAttention:
                          versionHistory.status?.enabled === true &&
                          (versionHistory.status.state !== 'ready' ||
                            versionHistory.status.diagnostics?.healthy ===
                              false),
                        pendingCount:
                          versionHistory.status?.pending_managed_paths
                            ?.length || 0,
                        pendingTruncated:
                          versionHistory.status
                            ?.pending_managed_paths_truncated === true,
                        onEnable: versionHistory.requestEnable,
                        onSave: versionHistory.save,
                        onOpenHistory: () => setVersionHistoryOpen(true),
                      }
                    : undefined
                }
              />
            ) : null
          }
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
