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

import BottomBox, { type FileAttachment } from '@/components/ChatBox/BottomBox';
import { setWorkspaceSendRecovery } from '@/components/Workspace/sendRecovery';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { useNewSessionModelQuota } from '@/hooks/useNewSessionModelQuota';
import { useSpaceSwitch } from '@/hooks/useSpaceSwitch';
import { useUsageIncidentBanner } from '@/hooks/useUsageIncidentBanner';
import { useHost } from '@/host';
import { notifyError } from '@/lib/notifyError';
import {
  parseSpaceModelChoice,
  SPACE_MODEL_METADATA_KEY,
} from '@/lib/spaceModelChoice';
import { startSessionInSpace } from '@/lib/startSessionInSpace';
import { cn } from '@/lib/utils';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore, WorkspaceTab } from '@/store/pageTabStore';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface SpaceQuickComposerProps {
  spaceId: string;
  /** Legacy Spaces are read-only, so they can't start a Session. */
  readOnly?: boolean;
  className?: string;
}

/**
 * The New session composer on a Space's page in Home: attachments,
 * connectors, skills, mode, access and model, all for this Space. Access and
 * model save to the Space as they change. Send starts a Session in the Space
 * and opens it right away, under the Space in Home's sidebar, with the same
 * model and usage checks as New session.
 */
export function SpaceQuickComposer({
  spaceId,
  readOnly = false,
  className,
}: SpaceQuickComposerProps) {
  const { t } = useTranslation();
  const host = useHost();
  const navigate = useNavigate();
  const { switchToSpace, switchingSpaceId } = useSpaceSwitch();
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [sessionMode, setSessionMode] = useState<SessionModeType>(
    SessionMode.SINGLE_AGENT
  );
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The same model and usage checks as the New session composer, for this
  // Space rather than the active one.
  const { token, user_id, modelType } = useAuthStore();
  const space = useSpaceStore((state) => state.spaces[spaceId]);
  const { hasModel } = useModelConfigCheck();
  const canResolveSpaceModelAtLaunch = Boolean(
    token &&
    space &&
    !readOnly &&
    !space.id.startsWith('legacy_') &&
    (!space.userId || space.userId === String(user_id))
  );
  const canStartWithModel = hasModel || canResolveSpaceModelAtLaunch;
  const spaceModelType = parseSpaceModelChoice(
    space?.metadata?.[SPACE_MODEL_METADATA_KEY]
  )?.modelType;
  const modelQuota = useNewSessionModelQuota(
    canResolveSpaceModelAtLaunch ? spaceId : null,
    spaceModelType ?? modelType
  );
  const incidentBanner = useUsageIncidentBanner(
    modelQuota.isCurrentAccount ? (modelQuota.effectiveModelType ?? '') : ''
  );
  const usageLimitBanner = modelQuota.error
    ? {
        message: modelQuota.error.message,
        actionLabel: t('chat.notice-refresh'),
        severity: 'danger' as const,
        onAction: modelQuota.refresh,
      }
    : incidentBanner
      ? {
          ...incidentBanner,
          onAction: () => {
            incidentBanner.onAction();
            modelQuota.refresh();
          },
          onRefresh: incidentBanner.onRefresh
            ? () => {
                incidentBanner.onRefresh?.();
                modelQuota.refresh();
              }
            : undefined,
        }
      : null;

  const disabled =
    readOnly ||
    sending ||
    switchingSpaceId !== null ||
    !canStartWithModel ||
    modelQuota.blocked;

  /** Show the new Session in Home, under its Space. */
  const showSession = () => {
    const pageTabs = usePageTabStore.getState();
    pageTabs.setHomeSpaceFolded(spaceId, false);
    pageTabs.setActiveWorkspaceTab(WorkspaceTab.Project);
    pageTabs.setShellPlace('home');
    closeSettings();
    navigate('/');
  };

  /** The server refused the Session: the message waits in New session. */
  const returnRejectedMessage = (sent: {
    message: string;
    files: FileAttachment[];
  }) => {
    setWorkspaceSendRecovery({
      spaceId,
      tab: WorkspaceTab.NewProject,
      message: sent.message,
      files: sent.files,
    });
    usePageTabStore.getState().setActiveWorkspaceTab(WorkspaceTab.NewProject);
  };

  const send = () => {
    const trimmed = message.trim();
    if (!trimmed || disabled) return;
    const sent = { message: trimmed, files };
    setSending(true);
    void runAfterWorkspaceConfigurationSave(async () => {
      let opened = false;
      try {
        // Re-read usage on Send, like New session, before anything changes.
        // Its context check is pinned to the Space active now, so it runs
        // before the switch; creation guards the account itself.
        await modelQuota.beforeCreate();
        if (useSpaceStore.getState().activeSpaceId !== spaceId) {
          const switched = await switchToSpace(spaceId, {
            project: null,
            tab: null,
            hydrate: false,
          });
          if (!switched) return;
        }
        await startSessionInSpace({
          spaceId,
          message: sent.message,
          files: sent.files,
          sessionMode,
          onOpened: () => {
            opened = true;
            showSession();
          },
          onRejected: () => returnRejectedMessage(sent),
        });
      } catch (error) {
        console.error('[SpaceQuickComposer] Failed to start Session:', error);
        notifyError(
          error instanceof Error ? error : t('layout.failed-to-start-task')
        );
      } finally {
        // Before the Session opened, this page still owns the message.
        if (!opened && mountedRef.current) setSending(false);
      }
    });
  };

  const addFiles = useCallback(async () => {
    try {
      const result = await host?.electronAPI?.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });
      if (result?.success && result.files?.length) {
        setFiles((current) => [
          ...current,
          ...result.files.filter(
            (picked: FileAttachment) =>
              !current.some((file) => file.filePath === picked.filePath)
          ),
        ]);
      }
    } catch (error) {
      console.error('[SpaceQuickComposer] Select file failed:', error);
    }
  }, [host, t]);

  return (
    <div data-space-quick-composer className={cn('w-full min-w-0', className)}>
      <BottomBox
        layout="inline"
        state="input"
        footerSpaceId={spaceId}
        noModelOverlay={!readOnly && !canStartWithModel && !modelQuota.blocked}
        onSelectModel={() => openSettings('models')}
        usageLimitBanner={usageLimitBanner}
        inputProps={{
          value: message,
          onChange: setMessage,
          onSend: send,
          files,
          onFilesChange: setFiles,
          onAddFile: addFiles,
          allowDragDrop: true,
          disabled,
          textareaRef,
          placeholder: readOnly
            ? t('layout.spaces-legacy-readonly-hint')
            : t('layout.project-task-placeholder'),
        }}
        sessionMode={sessionMode}
        onSessionModeChange={setSessionMode}
        sessionModeSelectInteractive={!readOnly}
        modelSelectDisabled={readOnly || sending}
      />
    </div>
  );
}
