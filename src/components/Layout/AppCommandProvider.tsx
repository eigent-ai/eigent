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

import KeyboardShortcutsDialog from '@/components/Dialog/KeyboardShortcutsDialog';
import ReportBugDialog from '@/components/Dialog/ReportBugDialog';
import { useDesktopShortcutPlatform } from '@/hooks/useDesktopShortcutPlatform';
import { useHost, type AppShellElectronAPI } from '@/host';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { isSettingsRoutePath, shellBackState } from '@/lib/shellRoutes';
import { runAfterWorkspaceConfigurationSave } from '@/lib/workspaceConfigurationNavigationGuard';
import { APP_COMMAND, type AppCommandId } from '@/shared/appCommands';
import { normalizeNativeMenuLocale } from '@/shared/nativeMenu';
import { WorkspaceTab, usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export type ExecuteAppCommand = (command: AppCommandId) => void;

export const AppCommandContext = createContext<ExecuteAppCommand | null>(null);

export function useAppCommand(): ExecuteAppCommand {
  const executeAppCommand = useContext(AppCommandContext);
  if (!executeAppCommand) {
    throw new Error('useAppCommand must be used within AppCommandProvider');
  }
  return executeAppCommand;
}

export function AppCommandProvider({ children }: { children: ReactNode }) {
  const host = useHost();
  const appShellElectronAPI = host?.electronAPI as
    AppShellElectronAPI | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const { i18n, t } = useTranslation();
  const setActiveProject = useProjectRuntimeStore(
    (state) => state.setActiveProject
  );
  const setActiveWorkspaceTab = usePageTabStore(
    (state) => state.setActiveWorkspaceTab
  );
  const requestWorkspaceChatFocus = usePageTabStore(
    (state) => state.requestWorkspaceChatFocus
  );
  const activeWorkspaceTab = usePageTabStore(
    (state) => state.activeWorkspaceTab
  );
  const chatTimelineDetailLevel = usePageTabStore(
    (state) => state.chatTimelineDetailLevel
  );
  const setChatTimelineDetailLevel = usePageTabStore(
    (state) => state.setChatTimelineDetailLevel
  );
  const toggleSessionPreview = usePageTabStore(
    (state) => state.toggleSessionPreview
  );
  const openPreviewTab = usePageTabStore((state) => state.openPreviewTab);
  const toggleWorkspaceSidebar = usePageTabStore(
    (state) => state.toggleWorkspaceSidebar
  );
  const requestToggleSessionSidePanel = usePageTabStore(
    (state) => state.requestToggleSessionSidePanel
  );
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);
  const closeSettings = useSettingsStore((state) => state.closeSettings);
  const [keyboardShortcutsOpen, setKeyboardShortcutsOpen] = useState(false);
  const [reportBugOpen, setReportBugOpen] = useState(false);
  const shortcutPlatform = useDesktopShortcutPlatform();
  const isWorkspacePage = location.pathname === '/';
  const isProjectTab =
    isWorkspacePage && activeWorkspaceTab === WorkspaceTab.Project;

  const openFilesTab = useCallback(() => {
    const projectStore = useProjectRuntimeStore.getState();
    let projectId = projectStore.activeProjectId;

    if (!projectId && activeSpaceId) {
      const spaceStore = useSpaceStore.getState();
      const projectsInSpace = spaceStore.getProjectsForSpace(activeSpaceId);
      if (projectsInSpace.length > 0) {
        const lastVisitedProjectId =
          spaceStore.lastVisitedProjectBySpace[activeSpaceId];
        const targetProject =
          projectsInSpace.find(
            (project) => project.id === lastVisitedProjectId
          ) ?? projectsInSpace[0];
        projectId = targetProject.id;
        projectStore.setActiveProject(projectId);
      }
    }

    if (!projectId) {
      toast.error(t('layout.workspace-select-project'));
      return false;
    }

    const projectChatStore = projectStore.peekActiveChatStore(projectId);
    const taskId = projectChatStore?.getState().activeTaskId;
    if (taskId) {
      projectChatStore.getState().setNuwFileNum(taskId, 0);
    }

    setActiveWorkspaceTab(WorkspaceTab.Files, {
      clearFilesForProjectId: projectId,
    });

    const needsRemoteHistoryHydration =
      projectStore.getProjectById(projectId)?.metadata
        ?.remoteHistoryHydrationPending === true;
    if (
      !projectChatStore ||
      projectStore.historyLoadIncompleteProjectIds[projectId] ||
      needsRemoteHistoryHydration
    ) {
      void ensureProjectRuntimeLoaded(projectStore, projectId, {
        requireActiveSelection: true,
      });
    }
    return true;
  }, [activeSpaceId, setActiveWorkspaceTab, t]);

  const executeAppCommand = useCallback<ExecuteAppCommand>(
    (command) => {
      switch (command) {
        case APP_COMMAND.openSettings:
          openSettings('settings');
          return;
        case APP_COMMAND.newProject:
          void runAfterWorkspaceConfigurationSave(() => {
            closeSettings();
            setActiveProject(null);
            setActiveWorkspaceTab(WorkspaceTab.NewProject);
            requestWorkspaceChatFocus();
            navigate('/');
          });
          return;
        case APP_COMMAND.keyboardShortcuts:
          setKeyboardShortcutsOpen(true);
          return;
        case APP_COMMAND.reportBug:
          setReportBugOpen(true);
          return;
        case APP_COMMAND.toggleTimelineView:
          if (isProjectTab) {
            setChatTimelineDetailLevel(
              chatTimelineDetailLevel === 'trajectory'
                ? 'narrative'
                : 'trajectory'
            );
          }
          return;
        case APP_COMMAND.togglePreviewPanel:
          if (isProjectTab) toggleSessionPreview();
          return;
        case APP_COMMAND.openPreviewBrowser:
          if (isProjectTab) openPreviewTab('browser');
          return;
        case APP_COMMAND.openPreviewTerminal:
          if (isProjectTab) openPreviewTab('terminal');
          return;
        case APP_COMMAND.toggleWorkspaceSidebar:
          if (isWorkspacePage) toggleWorkspaceSidebar();
          return;
        case APP_COMMAND.toggleSessionSidePanel:
          if (isProjectTab) requestToggleSessionSidePanel();
          return;
        case APP_COMMAND.navigateHome:
          void runAfterWorkspaceConfigurationSave(() => {
            setActiveProject(null);
            closeSettings();
            navigate('/home?section=spaces', {
              state: isSettingsRoutePath(location.pathname)
                ? location.state
                : shellBackState(`${location.pathname}${location.search}`),
            });
          });
          return;
        case APP_COMMAND.navigateWorkspace:
          void runAfterWorkspaceConfigurationSave(() => {
            closeSettings();
            setActiveWorkspaceTab(WorkspaceTab.Workforce);
            navigate('/');
          });
          return;
        case APP_COMMAND.navigateFiles:
          void runAfterWorkspaceConfigurationSave(() => {
            if (!openFilesTab()) return;
            closeSettings();
            navigate('/');
          });
          return;
        case APP_COMMAND.navigateScheduled:
          void runAfterWorkspaceConfigurationSave(() => {
            closeSettings();
            setActiveWorkspaceTab(WorkspaceTab.Triggers);
            navigate('/');
          });
          return;
        case APP_COMMAND.navigateDispatch:
          void runAfterWorkspaceConfigurationSave(() => {
            closeSettings();
            setActiveWorkspaceTab(WorkspaceTab.Dispatch);
            navigate('/');
          });
          return;
        case APP_COMMAND.navigateConfiguration:
          if (!activeSpaceId) return;
          void runAfterWorkspaceConfigurationSave(() => {
            closeSettings();
            navigate(
              `/home?section=spaces&spaceId=${encodeURIComponent(activeSpaceId)}&spaceTab=workspace-profile`,
              {
                state: shellBackState(`${location.pathname}${location.search}`),
              }
            );
          });
          return;
      }
    },
    [
      activeSpaceId,
      chatTimelineDetailLevel,
      closeSettings,
      isProjectTab,
      isWorkspacePage,
      location.pathname,
      location.search,
      location.state,
      navigate,
      openFilesTab,
      openPreviewTab,
      requestToggleSessionSidePanel,
      requestWorkspaceChatFocus,
      setActiveProject,
      setChatTimelineDetailLevel,
      setActiveWorkspaceTab,
      toggleSessionPreview,
      toggleWorkspaceSidebar,
    ]
  );

  useEffect(() => {
    return appShellElectronAPI?.onAppCommand?.(executeAppCommand);
  }, [appShellElectronAPI, executeAppCommand]);

  useEffect(() => {
    const locale = i18n.resolvedLanguage ?? i18n.language;
    const nativeMenuLocale = normalizeNativeMenuLocale(locale);
    if (nativeMenuLocale) {
      appShellElectronAPI?.setNativeMenuLocale?.(nativeMenuLocale);
    }
  }, [appShellElectronAPI, i18n.language, i18n.resolvedLanguage]);

  /**
   * On Windows and Linux the native menu deliberately leaves Ctrl+N, Ctrl+B,
   * and Ctrl+W to the renderer (see `isTerminalOwnedAccelerator`), so the
   * embedded terminal keeps its readline bindings. Dispatch them here instead,
   * and step aside whenever the terminal -- or any text surface -- has focus.
   */
  useEffect(() => {
    if (shortcutPlatform === 'darwin') return;

    const handleTerminalOwnedShortcut = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (!['n', 'b', 'w'].includes(key)) return;

      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          active.closest('.xterm') !== null ||
          ['INPUT', 'TEXTAREA'].includes(active.tagName))
      ) {
        return;
      }

      if (key === 'w') {
        if (!appShellElectronAPI?.closeWindow) return;
        event.preventDefault();
        appShellElectronAPI.closeWindow(false);
        return;
      }

      const command =
        key === 'n'
          ? APP_COMMAND.newProject
          : key === 'b'
            ? APP_COMMAND.toggleWorkspaceSidebar
            : undefined;
      if (!command) return;

      event.preventDefault();
      executeAppCommand(command);
    };

    window.addEventListener('keydown', handleTerminalOwnedShortcut);
    return () =>
      window.removeEventListener('keydown', handleTerminalOwnedShortcut);
  }, [appShellElectronAPI, executeAppCommand, shortcutPlatform]);

  return (
    <AppCommandContext.Provider value={executeAppCommand}>
      {children}
      <KeyboardShortcutsDialog
        open={keyboardShortcutsOpen}
        onOpenChange={setKeyboardShortcutsOpen}
        platform={shortcutPlatform}
      />
      <ReportBugDialog open={reportBugOpen} onOpenChange={setReportBugOpen} />
    </AppCommandContext.Provider>
  );
}
