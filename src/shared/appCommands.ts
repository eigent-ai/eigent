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

export const APP_COMMAND_CHANNEL = 'app-command' as const;

export const APP_COMMAND = {
  openSettings: 'open-settings',
  newProject: 'new-project',
  keyboardShortcuts: 'keyboard-shortcuts',
  reportBug: 'report-bug',
  toggleTimelineView: 'toggle-timeline-view',
  togglePreviewPanel: 'toggle-preview-panel',
  openPreviewBrowser: 'open-preview-browser',
  openPreviewTerminal: 'open-preview-terminal',
  toggleWorkspaceSidebar: 'toggle-workspace-sidebar',
  toggleSessionSidePanel: 'toggle-session-side-panel',
  navigateHome: 'navigate-home',
  navigateWorkspace: 'navigate-workspace',
  navigateFiles: 'navigate-files',
  navigateScheduled: 'navigate-scheduled',
  navigateDispatch: 'navigate-dispatch',
  navigateConfiguration: 'navigate-configuration',
} as const;

export type AppCommandId = (typeof APP_COMMAND)[keyof typeof APP_COMMAND];

export const APP_COMMAND_IDS = [
  APP_COMMAND.openSettings,
  APP_COMMAND.newProject,
  APP_COMMAND.keyboardShortcuts,
  APP_COMMAND.reportBug,
  APP_COMMAND.toggleTimelineView,
  APP_COMMAND.togglePreviewPanel,
  APP_COMMAND.openPreviewBrowser,
  APP_COMMAND.openPreviewTerminal,
  APP_COMMAND.toggleWorkspaceSidebar,
  APP_COMMAND.toggleSessionSidePanel,
  APP_COMMAND.navigateHome,
  APP_COMMAND.navigateWorkspace,
  APP_COMMAND.navigateFiles,
  APP_COMMAND.navigateScheduled,
  APP_COMMAND.navigateDispatch,
  APP_COMMAND.navigateConfiguration,
] as const satisfies readonly AppCommandId[];

export function isAppCommandId(value: unknown): value is AppCommandId {
  return (
    typeof value === 'string' &&
    (APP_COMMAND_IDS as readonly string[]).includes(value)
  );
}
