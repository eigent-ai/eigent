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

import { SPACE_DETAIL_TABS } from '@/components/Home/SpaceDetailTabsNav';
import { resources } from '@/i18n/locales';
import {
  getCustomWorkSessionName,
  isPlaceholderProjectName,
  resolveWorkSessionDisplayName,
} from '@/lib/spaceLabel';
import { formatToolDisplayName } from '@/lib/toolkitIcons';
import { APP_COMMAND } from '@/shared/appCommands';
import { WorkspaceTab } from '@/store/pageTabStore';
import { ExecutionType, TriggerType } from '@/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Product language uses Session. Project remains the backend aggregate and
 * projectId remains the boundary identifier. A Run is one execution inside a
 * Session and must never be translated back to Session.
 */
const retiredProjectNouns =
  /\bprojects?\b|proyectos?|projets?|progetti?|projekte?n?|проек(?:т|та|ты|тов|те)|プロジェクト|프로젝트|مشروع|مشاريع|项目|項目|專案/i;

const terminologyDocument = readFileSync(
  resolve(process.cwd(), 'docs/product-terminology.md'),
  'utf8'
);
const workspaceConfigurationSource = readFileSync(
  resolve(process.cwd(), 'src/service/workspaceConfigurationApi.ts'),
  'utf8'
);

const TERMINOLOGY_CONTRACT_ROWS = [
  [
    'Session execution',
    'Run',
    '`WorkSessionRun*`; Session-owned `Run*`',
    'Run APIs; legacy `Task`, `taskId`, `task_id`',
  ],
  [
    'Automation definition',
    'Automation',
    '`Automation*`',
    '`Trigger*`, `TriggerType`, trigger routes and stores',
  ],
  [
    'Automation execution',
    'Automation Run',
    '`AutomationRun*`',
    '`TriggerExecution`, `ExecutionType`, `ExecutionStatus`, `execution_id`',
  ],
  [
    'Space filesystem',
    'Files',
    '`FilesBrowser`, `File*`, `FileSource*`',
    'folder/workdir APIs; route value `context`; tab value `files`',
  ],
  [
    'Session-scoped resources',
    'Context',
    '`SessionContext*`',
    'attachments, skill, connector, and MCP compatibility sources',
  ],
  [
    'General AI actor',
    'Agent',
    '`Agent*`',
    'legacy `Worker*`, `workerListData`, `getWorkerList`, `setWorkerList`',
  ],
  [
    'Shareable Space setup',
    'Space profile',
    '`SpaceProfile*`',
    '`WorkspaceBundle*`, document kind `WorkspaceBundle`',
  ],
  [
    'Live Space configuration',
    'Space settings',
    '`SpaceSettings*`',
    '`WorkspaceConfiguration*`; route value `workspace-profile`',
  ],
  [
    'Eigent-wide preferences',
    'App settings',
    '`AppSettings*`',
    'existing Settings routes and stores',
  ],
  [
    'Invocable agent action',
    'Tool',
    '`Tool*`, `ToolCall*`',
    '`Toolkit*`, `toolkit_name`, toolkit lifecycle events',
  ],
] as const;

function readTerminologyTableRow(feature: string): string[] {
  const row = terminologyDocument
    .split('\n')
    .filter((candidate) => candidate.startsWith('|'))
    .map((candidate) =>
      candidate
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
    .find(([firstCell]) => firstCell === feature);
  expect(row, `${feature} should exist in the terminology map`).toBeDefined();
  return row!;
}

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
] as const;

const sessionNavigationLabels = {
  'en-US': 'Sessions',
  'zh-Hans': '会话',
  'zh-Hant': '工作階段',
  es: 'Sesiones',
  ja: 'セッション',
  de: 'Sitzungen',
  fr: 'Sessions',
  ru: 'Сессии',
  it: 'Sessioni',
  ar: 'الجلسات',
  ko: '세션',
} as const;

const runLabels = {
  'en-US': [
    'Untitled run',
    'All runs',
    'Delete run',
    'Are you sure you want to delete this run? This action cannot be undone.',
  ],
  'zh-Hans': [
    '未命名运行',
    '全部运行',
    '删除运行',
    '您确定要删除此次运行吗？此操作无法撤销。',
  ],
  'zh-Hant': [
    '未命名執行',
    '全部執行',
    '刪除執行',
    '您確定要刪除此執行嗎？此操作無法撤銷。',
  ],
  es: [
    'Ejecución sin título',
    'Todas las ejecuciones',
    'Eliminar ejecución',
    '¿Estás seguro de que quieres eliminar esta ejecución? Esta acción no se puede deshacer.',
  ],
  ja: [
    '無題の実行',
    'すべての実行',
    '実行を削除',
    'この実行を削除してもよろしいですか？この操作は元に戻せません。',
  ],
  de: [
    'Unbenannter Lauf',
    'Alle Läufe',
    'Lauf löschen',
    'Möchten Sie diesen Lauf wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
  ],
  fr: [
    'Exécution sans titre',
    'Toutes les exécutions',
    'Supprimer l’exécution',
    'Êtes-vous sûr de vouloir supprimer cette exécution ? Cette action ne peut pas être annulée.',
  ],
  ru: [
    'Запуск без названия',
    'Все запуски',
    'Удалить запуск',
    'Вы уверены, что хотите удалить этот запуск? Это действие нельзя отменить.',
  ],
  it: [
    'Esecuzione senza titolo',
    'Tutte le esecuzioni',
    'Elimina esecuzione',
    'Sei sicuro di voler eliminare questa esecuzione? Questa azione non può essere annullata.',
  ],
  ar: [
    'عملية تشغيل بلا عنوان',
    'جميع عمليات التشغيل',
    'حذف عملية التشغيل',
    'هل أنت متأكد من أنك تريد حذف عملية التشغيل هذه؟ لا يمكن التراجع عن هذا الإجراء.',
  ],
  ko: [
    '제목 없는 실행',
    '모든 실행',
    '실행 삭제',
    '이 실행을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
  ],
} as const;

const activeRunSurfaceLabels = {
  'en-US': {
    plural: 'Runs',
    delete: 'Delete run',
    confirmation:
      'Are you sure you want to delete this run? This action cannot be undone.',
    empty: 'No runs found.',
    count: '{{count}} runs',
  },
  'zh-Hans': {
    plural: '运行',
    delete: '删除运行',
    confirmation: '您确定要删除此次运行吗？此操作无法撤销。',
    empty: '未找到运行。',
    count: '{{count}} 次运行',
  },
  'zh-Hant': {
    plural: '執行',
    delete: '刪除執行',
    confirmation: '您確定要刪除此執行嗎？此操作無法撤銷。',
    empty: '找不到執行。',
    count: '{{count}} 次執行',
  },
  es: {
    plural: 'Ejecuciones',
    delete: 'Eliminar ejecución',
    confirmation:
      '¿Estás seguro de que quieres eliminar esta ejecución? Esta acción no se puede deshacer.',
    empty: 'No se encontraron ejecuciones.',
    count: '{{count}} ejecuciones',
  },
  ja: {
    plural: '実行',
    delete: '実行を削除',
    confirmation:
      'この実行を削除してもよろしいですか？この操作は元に戻せません。',
    empty: '実行が見つかりません。',
    count: '実行：{{count}}件',
  },
  de: {
    plural: 'Läufe',
    delete: 'Lauf löschen',
    confirmation:
      'Möchten Sie diesen Lauf wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
    empty: 'Keine Läufe gefunden.',
    count: '{{count}} Läufe',
  },
  fr: {
    plural: 'Exécutions',
    delete: 'Supprimer l’exécution',
    confirmation:
      'Êtes-vous sûr de vouloir supprimer cette exécution ? Cette action ne peut pas être annulée.',
    empty: 'Aucune exécution trouvée.',
    count: '{{count}} exécutions',
  },
  ru: {
    plural: 'Запуски',
    delete: 'Удалить запуск',
    confirmation:
      'Вы уверены, что хотите удалить этот запуск? Это действие нельзя отменить.',
    empty: 'Запуски не найдены.',
    count: 'Запусков: {{count}}',
  },
  it: {
    plural: 'Esecuzioni',
    delete: 'Elimina esecuzione',
    confirmation:
      'Sei sicuro di voler eliminare questa esecuzione? Questa azione non può essere annullata.',
    empty: 'Nessuna esecuzione trovata.',
    count: '{{count}} esecuzioni',
  },
  ar: {
    plural: 'عمليات التشغيل',
    delete: 'حذف عملية التشغيل',
    confirmation:
      'هل أنت متأكد من أنك تريد حذف عملية التشغيل هذه؟ لا يمكن التراجع عن هذا الإجراء.',
    empty: 'لم يتم العثور على عمليات تشغيل.',
    count: 'عمليات التشغيل: {{count}}',
  },
  ko: {
    plural: '실행',
    delete: '실행 삭제',
    confirmation: '이 실행을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.',
    empty: '실행을 찾을 수 없습니다.',
    count: '실행 {{count}}개',
  },
} as const;

const MEMORY_DIRECTORY_KEYS = [
  'layout.memory-directory-space-description',
  'layout.memory-directory-project-description',
  'layout.memory-directory-locations-with-memory',
  'layout.memory-directory-saved-notes',
  'layout.memory-directory-search',
  'layout.memory-directory-load-error',
  'layout.memory-directory-loading',
  'layout.memory-directory-empty-title',
  'layout.memory-directory-empty-description',
  'layout.memory-directory-no-match',
  'layout.memory-directory-note-count',
  'layout.memory-directory-session-count',
  'layout.memory-directory-parent-space',
  'layout.memory-directory-capacity-used',
  'layout.memory-directory-token-count',
  'layout.memory-directory-capacity-label',
  'layout.memory-directory-manage-label',
  'layout.memory-directory-manage',
] as const;

const IDENTICAL_MEMORY_TRANSLATION_ALLOWLIST = new Set([
  'es:layout.memory-directory-token-count',
]);

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

describe('Session product terminology', () => {
  it.each(Object.entries(sessionNavigationLabels))(
    'uses the canonical Session label in %s',
    (locale, expectedLabel) => {
      const translation =
        resources[locale as keyof typeof sessionNavigationLabels].translation;
      expect(translation.layout.projects).toBe(expectedLabel);
    }
  );

  it.each(Object.keys(sessionNavigationLabels))(
    'retires the Product Project noun from Session copy in %s',
    (locale) => {
      const translation =
        resources[locale as keyof typeof sessionNavigationLabels].translation;
      const offenders = SESSION_ENTITY_KEYS.filter((key) =>
        retiredProjectNouns.test(readKey(translation, key))
      ).map((key) => `${key}: ${readKey(translation, key)}`);

      expect(offenders).toEqual([]);
    }
  );

  it.each(Object.entries(runLabels))(
    'keeps Runs distinct from Sessions in %s',
    (locale, expected) => {
      const { layout } =
        resources[locale as keyof typeof runLabels].translation;
      expect([
        layout['sessions-untitled'],
        layout['sessions-full-title'],
        layout['delete-run'],
        layout['delete-run-confirmation'],
      ]).toEqual(expected);
    }
  );

  it.each(Object.entries(activeRunSurfaceLabels))(
    'uses Run for visible history records in %s',
    (locale, expected) => {
      const { dashboard, layout } =
        resources[locale as keyof typeof activeRunSurfaceLabels].translation;

      expect(layout.tasks).toBe(expected.plural);
      expect(layout['tasks-heading']).toBe(expected.plural);
      expect(layout['delete-task']).toBe(expected.delete);
      expect(layout['delete-task-confirmation']).toBe(expected.confirmation);
      expect(dashboard['no-tasks-found']).toBe(expected.empty);
      expect(layout['home-space-stat-tasks']).toBe(expected.count);
    }
  );

  it.each(Object.keys(activeRunSurfaceLabels))(
    'localizes the Memory directory in %s',
    (locale) => {
      const translation =
        resources[locale as keyof typeof activeRunSurfaceLabels].translation;
      const values = MEMORY_DIRECTORY_KEYS.map((key) =>
        readKey(translation, key)
      );

      expect(values.every((value) => value.trim().length > 0)).toBe(true);
      if (locale !== 'en-US') {
        const englishValues = MEMORY_DIRECTORY_KEYS.map((key) =>
          readKey(resources['en-US'].translation, key)
        );
        const untranslatedKeys = MEMORY_DIRECTORY_KEYS.filter(
          (key, index) =>
            values[index] === englishValues[index] &&
            !IDENTICAL_MEMORY_TRANSLATION_ALLOWLIST.has(`${locale}:${key}`)
        );
        expect(untranslatedKeys).toEqual([]);
      }
    }
  );

  it('preserves frozen backend and route identifiers', () => {
    expect(APP_COMMAND.newProject).toBe('new-project');
    expect(WorkspaceTab.Project).toBe('project');
    expect(WorkspaceTab.NewProject).toBe('new-project');
  });

  it('preserves frozen Automation, Files, and Space settings identifiers', () => {
    expect(WorkspaceTab.Files).toBe('files');
    expect(WorkspaceTab.Triggers).toBe('triggers');
    expect(SPACE_DETAIL_TABS).toEqual(
      expect.arrayContaining(['triggers', 'context', 'workspace-profile'])
    );
    expect(APP_COMMAND.navigateFiles).toBe('navigate-files');
    expect(APP_COMMAND.navigateScheduled).toBe('navigate-scheduled');
    expect(APP_COMMAND.navigateConfiguration).toBe('navigate-configuration');

    expect(TriggerType.Schedule).toBe('schedule');
    expect(TriggerType.Webhook).toBe('webhook');
    expect(TriggerType.Slack).toBe('slack_trigger');
    expect(ExecutionType.Scheduled).toBe('scheduled');
    expect(ExecutionType.Webhook).toBe('webhook');
    expect(ExecutionType.Slack).toBe('slack');

    expect(workspaceConfigurationSource).toContain("kind: 'WorkspaceBundle';");
  });

  it('presents the frozen native command as New session', () => {
    expect(resources['en-US'].translation.layout.nativeMenu.newProject).toBe(
      'New session'
    );
  });

  it('keeps the reviewed English session copy concise and actionable', () => {
    const { chat, dashboard, layout, setting, triggers, workforce } =
      resources['en-US'].translation;

    expect({
      chatNewSession: chat['new-project'],
      dashboardNewSession: dashboard['new-project'],
      connectLocalFiles: chat['choose-agent-work-folder'],
      newSession: layout['new-project'],
      endSession: layout['end-project'],
      confirmEndSession: layout['ending-this-project-will-stop'],
      deleteSession: layout['delete-project'],
      sessionSettings: layout['project-settings'],
      sessionMemory: layout['memory-overview-project-title'],
      applyConflict: layout['workspace-apply-conflict-message'],
      discardChanges: layout['workspace-discard-confirm-message'],
      refreshFiles: layout['workspace-refresh-success'],
      refreshFilesFailed: layout['workspace-refresh-failed'],
      localBrainRequired: layout['workspace-folder-binding-local-only'],
      folderAlreadyConnected: layout['workspace-folder-already-bound'],
      folderUnavailable: layout['workspace-folder-unavailable'],
      configureTool: setting['configure {name} Toolkit'],
      automationSession: triggers['automation-project-description'],
      sessionRequired: triggers['project-id-required'],
      automationRunLimits: triggers['execution-settings'],
      spacesEmptyTitle: layout['spaces-hub-empty-title'],
      automationCount: layout['home-space-stat-triggers'],
      newAgent: workforce['new-worker'],
    }).toEqual({
      chatNewSession: 'Untitled session',
      dashboardNewSession: 'Untitled session',
      connectLocalFiles: 'Connect local files',
      newSession: 'New session',
      endSession: 'End session',
      confirmEndSession:
        'Ending this session stops any running work and marks the session as complete. You can resume it by sending another message.',
      deleteSession: 'Delete session',
      sessionSettings: 'Session settings',
      sessionMemory: 'Session memory',
      applyConflict:
        '{{count}} file(s) changed in the space before apply: {{paths}}. Open the affected session files, resolve the conflicts, then apply again.',
      discardChanges:
        'This forgets {{count}} pending apply change(s). The session files are not restored.',
      refreshFiles: 'Session files refreshed.',
      refreshFilesFailed: 'Failed to refresh session files.',
      localBrainRequired:
        'Local files need a local Brain. Switch this space to a local Brain to connect them.',
      folderAlreadyConnected:
        'This folder is already connected to another space. Pick a different folder, or disconnect it there first.',
      folderUnavailable:
        "This Brain can't reach that folder. Pick a folder on the same device as the Brain.",
      configureTool: 'Configure {{name}}',
      automationSession: 'Created automatically by a {{type}} automation',
      sessionRequired: 'A session is required',
      automationRunLimits: 'Automation run limits',
      spacesEmptyTitle: 'No spaces yet',
      automationCount: '{{count}} automations',
      newAgent: 'New agent',
    });
  });

  it('recognizes both legacy Project and current Session placeholders', () => {
    expect(isPlaceholderProjectName('New Project', '42')).toBe(true);
    expect(isPlaceholderProjectName('Project 42', '42')).toBe(true);
    expect(isPlaceholderProjectName('New Session', '42')).toBe(true);
    expect(isPlaceholderProjectName('Session 42', '42')).toBe(true);
    for (const userAuthoredName of [
      'Project',
      'Session',
      'Untitled Project',
      'Untitled Session',
      'Quarterly close',
    ]) {
      expect(isPlaceholderProjectName(userAuthoredName, '42')).toBe(false);
      expect(getCustomWorkSessionName(userAuthoredName, '42')).toBe(
        userAuthoredName
      );
    }
    expect(getCustomWorkSessionName('Project 42', '42')).toBeNull();
    expect(resolveWorkSessionDisplayName('New Project', '42', 'Session')).toBe(
      'Session'
    );
  });
});

describe('Product terminology engineering contract', () => {
  it.each(TERMINOLOGY_CONTRACT_ROWS)(
    'maps %s without renaming its compatibility boundary',
    (feature, userTerm, presentationName, compatibilityTerm) => {
      expect(readTerminologyTableRow(feature)).toEqual([
        feature,
        userTerm,
        presentationName,
        compatibilityTerm,
      ]);
    }
  );

  it('preserves the Session hierarchy and gives Automations a separate Run namespace', () => {
    expect(terminologyDocument).toContain('`Space → Session → Run → Step`');
    expect(terminologyDocument).toContain(
      '`Space → Automation → Automation Run → Step`'
    );
    expect(terminologyDocument).toContain(
      'Use `WorkSessionRun*` and `AutomationRun*`'
    );
    expect(terminologyDocument).toContain(
      'Do not label Session history records or execution entities as'
    );
    expect(terminologyDocument).toContain(
      'Use sentence case for UI labels and headings.'
    );
  });

  it('keeps Files, Context, Activity, and capability providers semantically distinct', () => {
    expect(terminologyDocument).toContain(
      "**Files** is the Space's durable filesystem and file browser."
    );
    expect(terminologyDocument).toContain(
      '**Context** is reserved for the Session side panel.'
    );
    expect(terminologyDocument).toContain(
      'separate **Added context** from **Activity**, **Tools used**, or **Used in'
    );
    expect(terminologyDocument).toContain(
      'Keep Connector, MCP server, Skill, Plugin, and Tool distinct.'
    );
  });

  it('formats frozen Toolkit identities as user-facing Tool names', () => {
    expect(formatToolDisplayName('Browser Toolkit')).toBe('Browser');
    expect(formatToolDisplayName('WebFetchToolkit')).toBe('WebFetch');
    expect(formatToolDisplayName('google_calendar_toolkit')).toBe(
      'google calendar'
    );
  });

  it('separates Automation start type from source', () => {
    expect(readTerminologyTableRow('Start type')).toEqual([
      'Start type',
      'Scheduled, Event, On demand',
      'How the Automation begins',
    ]);
    expect(readTerminologyTableRow('Source')).toEqual([
      'Source',
      'Eigent, Files, App or connector, API, Webhook',
      'Where the start signal originates',
    ]);
    expect(terminologyDocument).toContain(
      '**App automation** is not a start type.'
    );
  });

  it('separates the live settings surface from its shareable profile', () => {
    expect(terminologyDocument).toContain(
      '**Space settings** is the live editor for one Space'
    );
    expect(terminologyDocument).toContain(
      '**Space profile** is a portable, versioned, publishable representation'
    );
    expect(terminologyDocument).toContain(
      'Space template and Space profile are not synonyms.'
    );
    expect(terminologyDocument).toContain(
      'Reserve **Configuration** for serialized documents, APIs, machine-facing'
    );
  });
});
