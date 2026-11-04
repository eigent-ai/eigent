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

import {
  pinSpaceOrChoose,
  usePinnedSpaceIds,
} from '@/components/Layout/AppRail/pinnedSpaces';
import {
  canRenameSpace,
  SpaceRenameDialog,
} from '@/components/SpaceSidebar/SpaceRenameDialog';
import { SpaceSwitchDropdown } from '@/components/SpaceSidebar/SpaceSwitchDropdown';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { WorkspaceVersionHistoryDialog } from '@/components/Workspace/WorkspaceVersionHistoryDialog';
import { useOpenSpaceHomeTab } from '@/hooks/useSpaceSwitch';
import { useWorkspaceSavePoint } from '@/hooks/useWorkspaceSavePoint';
import { getActiveSpaceTriggerLabel } from '@/lib/spaceLabel';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ChevronDown, Folder } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The Workspace page's title: the Space's name, opening its menu (rename,
 * settings, Memory, pin, and the active Space's save points).
 */
export const SpaceHeaderMenu = forwardRef<
  HTMLButtonElement,
  { spaceId: string }
>(function SpaceHeaderMenu({ spaceId }, ref) {
  const { t } = useTranslation();
  const space = useSpaceStore((state) => state.spaces[spaceId] ?? null);
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const activeSpace = useSpaceStore((state) =>
    state.activeSpaceId ? (state.spaces[state.activeSpaceId] ?? null) : null
  );
  const unpinSpace = useSpaceStore((state) => state.unpinSpace);
  const pinned = usePinnedSpaceIds().includes(spaceId);
  const openSpaceHomeTab = useOpenSpaceHomeTab();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const [renameOpen, setRenameOpen] = useState(false);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  // Save points act on the active Space's folder, so they show only for it.
  // The save shortcut stays with the top bar, which is always mounted.
  const savePointsApply = spaceId === activeSpaceId;
  const versionHistory = useWorkspaceSavePoint({
    spaceId: activeSpaceId,
    space: activeSpace,
    email,
    userId,
  });
  const name = getActiveSpaceTriggerLabel(space?.name, t, {
    emptyLabelKey: 'layout.spaces-untitled',
  });
  const canRename = canRenameSpace(space);

  return (
    <>
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
        spaceId={renameOpen ? spaceId : null}
        onClose={() => setRenameOpen(false)}
      />
      <SpaceSwitchDropdown
        contentSideOffset={6}
        onOpenChange={(open) => {
          if (open && savePointsApply && versionHistory.supported) {
            void versionHistory.loadStatus();
          }
        }}
        trigger={
          <Button
            ref={ref}
            type="button"
            variant="ghost"
            size="sm"
            buttonRadius="full"
            className="-ml-ds-8 max-w-full min-w-0"
            aria-haspopup="menu"
            aria-label={name}
          >
            <DsIcon icon={Folder} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default">
              {name}
            </span>
            <DsIcon
              icon={ChevronDown}
              className="shrink-0 text-ds-ink-subtle-default"
              aria-hidden
            />
          </Button>
        }
        activeSpaceId={spaceId}
        canRenameActiveSpace={canRename}
        onRenameSpace={() => {
          if (canRename) setRenameOpen(true);
        }}
        onOpenSpaceSettings={() =>
          openSpaceHomeTab(spaceId, 'workspace-profile')
        }
        onOpenMemorySettings={() => openSpaceHomeTab(spaceId, 'memory')}
        pinMenu={{
          pinned,
          onToggle: () => {
            if (pinned) unpinSpace(spaceId);
            else pinSpaceOrChoose(spaceId);
          },
        }}
        contentAlign="start"
        triggerWrapperClassName="min-w-0 overflow-hidden rounded-full"
        savePointMenu={
          savePointsApply && versionHistory.supported
            ? {
                loading:
                  versionHistory.loading || versionHistory.status === null,
                saving: versionHistory.saving,
                enabled: versionHistory.status?.enabled === true,
                needsAttention:
                  versionHistory.status?.enabled === true &&
                  (versionHistory.status.state !== 'ready' ||
                    versionHistory.status.diagnostics?.healthy === false),
                pendingCount:
                  versionHistory.status?.pending_managed_paths?.length || 0,
                pendingTruncated:
                  versionHistory.status?.pending_managed_paths_truncated ===
                  true,
                onEnable: versionHistory.requestEnable,
                onSave: versionHistory.save,
                onOpenHistory: () => setVersionHistoryOpen(true),
              }
            : undefined
        }
      />
    </>
  );
});
