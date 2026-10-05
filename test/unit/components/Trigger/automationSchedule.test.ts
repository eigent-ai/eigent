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
  AUTOMATION_EXAMPLES,
  AUTOMATION_ROLE_IDS,
  getExamplesForRole,
} from '@/components/Trigger/automationExampleData';
import {
  formatScheduleLabel,
  getNextRun,
  isOneTimeCron,
  nextOccurrence,
  parseCron,
  scheduleToCron,
  type RecurringSchedule,
} from '@/components/Trigger/automationSchedule';
import enTriggers from '@/i18n/locales/en-us/triggers.json';
import { describe, expect, it } from 'vitest';

// A Wednesday at 12:00 local time, away from any DST change.
const REFERENCE = new Date(2026, 6, 15, 12, 0, 0);

describe('scheduleToCron / parseCron', () => {
  const cases: RecurringSchedule[] = [
    { frequency: 'daily', hour: 9, minute: 30 },
    { frequency: 'weekly', hour: 8, minute: 0, weekdays: [1, 5] },
    { frequency: 'monthly', hour: 23, minute: 45, dayOfMonth: 2 },
  ];

  it.each(cases)('round-trips a $frequency schedule', (schedule) => {
    const parsed = parseCron(scheduleToCron(schedule, REFERENCE), REFERENCE);
    expect(parsed).toMatchObject(schedule);
  });

  it('treats a cron with a fixed day and month as one-time', () => {
    expect(isOneTimeCron('0 9 14 7 *')).toBe(true);
    expect(isOneTimeCron('0 9 * * *')).toBe(false);
    expect(isOneTimeCron('0 9 2 * *')).toBe(false);
  });

  it('returns null for crons it cannot describe', () => {
    expect(parseCron('*/5 * * * *', REFERENCE)).toBeNull();
    expect(parseCron('not a cron', REFERENCE)).toBeNull();
  });
});

describe('nextOccurrence', () => {
  it('moves a daily run that already passed today to tomorrow', () => {
    const next = nextOccurrence(
      { frequency: 'daily', hour: 9, minute: 0 },
      REFERENCE
    );
    expect(next).toEqual(new Date(2026, 6, 16, 9, 0));
  });

  it('keeps a daily run later today', () => {
    const next = nextOccurrence(
      { frequency: 'daily', hour: 18, minute: 0 },
      REFERENCE
    );
    expect(next).toEqual(new Date(2026, 6, 15, 18, 0));
  });

  it('finds the next matching weekday', () => {
    const next = nextOccurrence(
      { frequency: 'weekly', hour: 9, minute: 0, weekdays: [1] },
      REFERENCE
    );
    expect(next).toEqual(new Date(2026, 6, 20, 9, 0));
  });

  it('has no next run for a one-time date in the past', () => {
    expect(
      nextOccurrence(
        {
          frequency: 'once',
          hour: 9,
          minute: 0,
          date: new Date(2026, 6, 14, 9, 0),
        },
        REFERENCE
      )
    ).toBeNull();
  });
});

describe('getNextRun', () => {
  it('prefers the scheduler next_run_at over the cron', () => {
    const next = getNextRun(
      {
        next_run_at: '2026-08-01T10:00:00Z',
        custom_cron_expression: scheduleToCron(
          { frequency: 'daily', hour: 9, minute: 0 },
          REFERENCE
        ),
      },
      REFERENCE
    );
    expect(next?.toISOString()).toBe('2026-08-01T10:00:00.000Z');
  });

  it('falls back to the cron when next_run_at is missing', () => {
    const next = getNextRun(
      {
        custom_cron_expression: scheduleToCron(
          { frequency: 'daily', hour: 18, minute: 0 },
          REFERENCE
        ),
      },
      REFERENCE
    );
    expect(next).toEqual(new Date(2026, 6, 15, 18, 0));
  });
});

describe('formatScheduleLabel', () => {
  const t = (key: string, options?: Record<string, unknown>) =>
    `${key}|${JSON.stringify(options ?? {})}`;

  it('lists weekdays Monday first', () => {
    const label = formatScheduleLabel(
      { frequency: 'weekly', hour: 9, minute: 5, weekdays: [0, 1] },
      t
    );
    expect(label).toContain('triggers.schedule-label-weekly');
    expect(label).toContain(
      '"days":"triggers.weekday-monday|{}, triggers.weekday-sunday|{}"'
    );
    expect(label).toContain('"time":"09:05"');
  });
});

describe('automation examples', () => {
  const copy = enTriggers as unknown as {
    roles: Record<string, string>;
    examples: Record<
      string,
      { title: string; description: string; prompt: string }
    >;
  };

  it('shows six default examples from six different roles', () => {
    const examples = getExamplesForRole(null);
    expect(examples).toHaveLength(6);
    expect(new Set(examples.map((ex) => ex.roleId)).size).toBe(6);
    expect(examples[0].id).toBe('meeting-prep-brief');
  });

  it.each(AUTOMATION_ROLE_IDS)(
    'shows six distinct examples for %s, its own three first',
    (role) => {
      const examples = getExamplesForRole(role);
      expect(examples).toHaveLength(6);
      expect(new Set(examples.map((ex) => ex.id)).size).toBe(6);
      expect(examples.slice(0, 3).every((ex) => ex.roleId === role)).toBe(true);
    }
  );

  it('has English copy for every role and example', () => {
    for (const role of AUTOMATION_ROLE_IDS) {
      expect(copy.roles[role]).toBeTruthy();
    }
    for (const example of AUTOMATION_EXAMPLES) {
      const entry = copy.examples[example.id];
      expect(entry?.title, example.id).toBeTruthy();
      expect(entry?.description, example.id).toBeTruthy();
      expect(entry?.prompt, example.id).toBeTruthy();
    }
  });

  it('keeps card titles and descriptions to six words or fewer', () => {
    for (const example of AUTOMATION_EXAMPLES) {
      const { title, description } = copy.examples[example.id];
      expect(title.split(/\s+/).length, title).toBeLessThanOrEqual(6);
      expect(description.split(/\s+/).length, description).toBeLessThanOrEqual(
        6
      );
    }
  });
});
