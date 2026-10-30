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
import { describe, expect, it } from 'vitest';

/**
 * The entity is an *Automation*; the event that starts it is its *trigger*.
 * Only three of the four trigger types are time-based, so the entity noun must
 * never be "Trigger" (the event, not the thing) nor "Scheduled task" (wrong for
 * Webhook/Slack/App, and it collides with the unrelated `Tasks` stat).
 *
 * This checks the keys that name the entity. Keys that describe the triggering
 * event itself -- `trigger-type`, the per-type labels -- are deliberately free
 * to say "trigger", because there it is the correct word.
 */
const retiredEntityNouns =
  /\btriggers?\b|\btriggered\b|\bscheduled tasks?\b|المحفزات|المشغلات|Disparadores|disparadores|Déclencheurs?|déclencheurs?|トリガー|스케줄된 작업|예약된 작업|트리거|Триггеры?|триггер(?:а|ов|ы)?|触发器|计划任务|触发监听器|觸發器|排程任務|觸發監聽器/i;

/** Keys whose value names the entity, in every locale. */
const ENTITY_NOUN_KEYS = [
  'triggers.title',
  'triggers.create-new',
  'triggers.trigger-details',
  'triggers.no-trigger-selected',
  'triggers.no-triggers',
  'triggers.name-placeholder',
  'triggers.name-required',
  'triggers.created-successfully',
  'triggers.failed-to-create',
  'triggers.failed-to-load',
  'triggers.activated',
  'triggers.deactivated',
  'triggers.deleted',
  'triggers.failed-to-delete',
  'triggers.updated-successfully',
  'triggers.trigger-label',
  'triggers.trigger-task',
  'triggers.trigger-overview',
  'triggers.add-trigger',
  'triggers.edit-trigger-agent',
  'triggers.delete-trigger',
  'triggers.create-hint',
  'triggers.automation-fallback-name',
  'triggers.automation-project-name',
  'layout.triggers',
  'layout.scheduled-tab',
  'layout.search-triggers',
  'layout.home-space-stat-triggers',
  'layout.triggers-reconnect-hint',
  'chat.task-completed-card-subtitle',
] as const;

const automationNavigationLabels = {
  'en-US': 'Automations',
  'zh-Hans': '自动化',
  'zh-Hant': '自動化',
  es: 'Automatizaciones',
  ja: 'オートメーション',
  de: 'Automatisierungen',
  fr: 'Automatisations',
  ru: 'Автоматизации',
  it: 'Automazioni',
  ar: 'الأتمتة',
  ko: '자동화',
} as const;

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

describe('Automation surface terminology', () => {
  it.each(Object.entries(automationNavigationLabels))(
    'keeps %s navigation labels and the page title concise',
    (locale, expectedLabel) => {
      const translation =
        resources[locale as keyof typeof automationNavigationLabels]
          .translation;

      expect(translation.layout.triggers).toBe(expectedLabel);
      expect(translation.layout['scheduled-tab']).toBe(expectedLabel);
      expect(translation.triggers.title).toBe(expectedLabel);
    }
  );

  it.each(Object.keys(automationNavigationLabels))(
    'names the entity "Automation" in %s',
    (locale) => {
      const translation =
        resources[locale as keyof typeof automationNavigationLabels]
          .translation;

      const offenders = ENTITY_NOUN_KEYS.filter((key) =>
        retiredEntityNouns.test(readKey(translation, key))
      ).map((key) => `${key}: ${readKey(translation, key)}`);

      expect(offenders).toEqual([]);
    }
  );

  it('keeps saying "trigger" where the trigger itself is meant', () => {
    const { triggers } = resources['en-US'].translation;

    // The event field keeps the correct word...
    expect(triggers['trigger-type']).toBe('Trigger');
    // ...and the per-type labels stay as the services name themselves.
    expect(triggers['schedule-trigger']).toBe('Schedule');
    expect(triggers['webhook-trigger']).toBe('Webhook');
    expect(triggers['slack-trigger']).toBe('Slack');
    expect(triggers['app-trigger']).toBe('App');
  });
});
