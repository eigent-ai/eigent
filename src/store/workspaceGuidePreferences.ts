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

export type WorkspaceGuideAudience = 'new' | 'existing';
export type WorkspaceGuideTabId = 'primary' | 'connect-tools' | 'use-cases';

export const WORKSPACE_GUIDE_TAB_ORDER: WorkspaceGuideTabId[] = [
  'primary',
  'connect-tools',
  'use-cases',
];

const WORKSPACE_GUIDE_TAB_IDS = new Set<WorkspaceGuideTabId>(
  WORKSPACE_GUIDE_TAB_ORDER
);

export function resolveWorkspaceGuideAudience(state: {
  workspaceGuideAudience?: unknown;
  isFirstLaunch?: unknown;
  onboardingCompleted?: unknown;
}): WorkspaceGuideAudience {
  if (
    state.workspaceGuideAudience === 'new' ||
    state.workspaceGuideAudience === 'existing'
  ) {
    return state.workspaceGuideAudience;
  }
  return state.isFirstLaunch === true && state.onboardingCompleted !== true
    ? 'new'
    : 'existing';
}

export function sanitizeDismissedWorkspaceGuideTabs(
  value: unknown
): WorkspaceGuideTabId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)].filter(
    (tabId): tabId is WorkspaceGuideTabId =>
      typeof tabId === 'string' &&
      WORKSPACE_GUIDE_TAB_IDS.has(tabId as WorkspaceGuideTabId)
  );
}
