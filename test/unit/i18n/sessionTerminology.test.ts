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

import { resources } from '@/i18n/locales';
import { APP_COMMAND } from '@/shared/appCommands';
import { WorkspaceTab } from '@/store/pageTabStore';
import { describe, expect, it } from 'vitest';

/**
 * The visible hierarchy is Space -> Session -> Task. Internal Project names
 * remain compatibility contracts and are asserted separately below.
 */
const retiredProjectNouns =
  /\bprojects?\b|proyectos?|projets?|progetti?|projekt(?:e|en|s)?|проект[а-яё]*|プロジェクト|프로젝트|مشروع|مشاريع|项目|項目|專案/iu;

/** UI copy that names or directly describes the Session entity. */
const SESSION_ENTITY_KEYS = [
  'layout.projects',
  'layout.new-project',
  'layout.achieve-project',
  'layout.end-project',
  'layout.ending-this-project-will-stop',
  'layout.yes-end-project',
  'layout.no-active-project-to-end',
  'layout.project-ended-successfully',
  'layout.failed-to-end-project',
  'layout.projects-hub',
  'layout.project-page-tab-project',
  'layout.project-settings',
  'layout.manage-project-details',
  'layout.project-name',
  'layout.enter-project-name',
  'layout.rename-project',
  'layout.no-tasks-in-project',
  'layout.delete-project',
  'layout.delete-project-confirmation',
  'layout.delete-space-confirmation',
  'layout.projects-heading',
  'layout.session-panel-agent-description',
  'layout.session-panel-subagent-description',
  'layout.workspace-work-in-project',
  'layout.workspace-select-project',
  'layout.workspace-history-projects',
  'layout.workspace-no-history-projects',
  'layout.memory-overview-project-title',
  'layout.memory-overview-no-projects',
  'layout.memory-overview-untitled-project',
  'layout.memory-overview-project-description',
  'layout.memory-overview-open-project',
  'layout.memory-editor-project-description',
  'layout.onboarding-step-2-subtitle',
  'layout.sessions-start-new',
  'layout.spaces-create-project-failed',
  'layout.spaces-legacy-readonly-hint',
  'layout.spaces-hub-description',
  'layout.spaces-hub-legacy-description',
  'layout.spaces-hub-new-project',
  'layout.spaces-hub-create-first-project',
  'layout.spaces-hub-empty-description',
  'layout.search-projects',
  'layout.home-space-stat-projects',
  'layout.files-tab-unbound-tooltip',
  'layout.workspace-project-submenu',
  'layout.workspace-apply-conflict-message',
  'layout.workspace-discard-confirm-message',
  'layout.workspace-refresh-success',
  'layout.workspace-refresh-failed',
  'layout.workspace-session-mode-label',
  'layout.workspace-session-mode-cycle-hint',
  'layout.shortcuts.group-project',
  'layout.shortcuts.new-project',
  'layout.nativeMenu.newProject',
  'dashboard.new-project',
  'dashboard.project-archives',
  'dashboard.ongoing-projects',
  'dashboard.no-projects-found',
  'chat.new-project',
  'triggers.automation-project-description',
  'triggers.project-id-required',
  'triggers.trigger-limit-reached',
  'triggers.activation-limit-reached',
  'setting.preferred-ide-description',
] as const;

function readKey(translation: unknown, dotted: string): string {
  const value = dotted
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[part]
          : undefined,
      translation
    );
  expect(typeof value, `${dotted} should be a string`).toBe('string');
  return value as string;
}

describe('Session surface terminology', () => {
  it.each(Object.entries(resources))(
    'removes the retired Project noun from %s Session copy',
    (_locale, resource) => {
      const offenders = SESSION_ENTITY_KEYS.filter((key) =>
        retiredProjectNouns.test(readKey(resource.translation, key))
      ).map((key) => `${key}: ${readKey(resource.translation, key)}`);

      expect(offenders).toEqual([]);
    }
  );

  it('uses the Space -> Session -> Task hierarchy in core English actions', () => {
    const { layout } = resources['en-US'].translation;

    expect(layout.projects).toBe('Sessions');
    expect(layout['new-project']).toBe('New session');
    expect(layout['rename-project']).toBe('Rename session');
    expect(layout['delete-project']).toBe('Delete session');
    expect(layout['delete-project-confirmation']).toContain('all its tasks');
    expect(layout['delete-space-confirmation']).toContain('all its sessions');
  });

  it('preserves internal command and persisted tab identifiers', () => {
    expect(APP_COMMAND.newProject).toBe('new-project');
    expect(WorkspaceTab.Project).toBe('project');
    expect(WorkspaceTab.NewProject).toBe('new-project');
  });
});
