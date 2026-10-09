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

import { AUTOMATION_EXAMPLES } from '@/components/Trigger/automationExampleData';
import {
  formatScheduleLabel,
  getNextRun,
  isOneTimeCron,
  nextOccurrence,
  parseCron,
  parseTriggerSchedule,
  scheduleToCron,
  type RecurringSchedule,
} from '@/components/Trigger/automationSchedule';
import enTriggers from '@/i18n/locales/en-us/triggers.json';
import { describe, expect, it } from 'vitest';
import { useTimeZone } from '../../../mocks/timeZone';

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
    examples: Record<
      string,
      { title: string; description: string; prompt: string }
    >;
  };

  it('provides one shared set of six distinct examples in a fixed order', () => {
    expect(AUTOMATION_EXAMPLES.map((example) => example.id)).toEqual([
      'meeting-prep-brief',
      'campaign-performance-recap',
      'hiring-pipeline-digest',
      'expense-report-review',
      'inbox-triage',
      'weekly-feature-usage-recap',
    ]);
  });
  it('has English copy for every shared example', () => {
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

describe('schedule date regressions', () => {
  it('round-trips Monday at the first day of a month without an undefined weekday', () => {
    const reference = new Date(2026, 9, 1, 12);
    const schedule = {
      frequency: 'weekly',
      hour: 9,
      minute: 0,
      weekdays: [1],
    } as const;
    const parsed = parseCron(
      scheduleToCron({ ...schedule, weekdays: [1] }, reference),
      reference
    );
    expect(parsed).toMatchObject(schedule);
    expect(formatScheduleLabel(parsed!, (key) => key)).not.toContain(
      'undefined'
    );
  });

  it('round-trips monthly day 1 across a UTC month boundary', () => {
    const reference = new Date(2026, 9, 1, 12);
    const schedule: RecurringSchedule = {
      frequency: 'monthly',
      hour: 9,
      minute: 0,
      dayOfMonth: 1,
    };
    const cron = scheduleToCron(schedule, reference);
    expect(parseCron(cron, reference)).toMatchObject(schedule);
    const localDate = new Date(2026, 9, 1, 9);
    if (localDate.getUTCDate() !== 1) expect(cron.split(' ')[2]).toBe('L');
  });

  it('refuses to silently clamp a monthly day 31 that shifts into the next UTC month', () => {
    const reference = new Date(2026, 11, 31, 12);
    const schedule: RecurringSchedule = {
      frequency: 'monthly',
      hour: 23,
      minute: 30,
      dayOfMonth: 31,
    };
    const date = new Date(2026, 11, 31, 23, 30);
    if (date.getUTCDate() === 1)
      expect(() => scheduleToCron(schedule, reference)).toThrow(RangeError);
    else
      expect(
        parseCron(scheduleToCron(schedule, reference), reference)
      ).toMatchObject(schedule);
  });

  it('rejects late-month shifts that would add or skip runs in short months', () => {
    const reference = new Date(2026, 0, 15, 12);
    for (const dayOfMonth of [28, 29, 30, 31]) {
      for (const hour of [0, 23]) {
        const schedule: RecurringSchedule = {
          frequency: 'monthly',
          hour,
          minute: 0,
          dayOfMonth,
        };
        const date = new Date(2026, 0, dayOfMonth, hour);
        const shift =
          (Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate()
          ) -
            Date.UTC(2026, 0, dayOfMonth)) /
          86400000;
        const unsupported =
          (shift > 0 && dayOfMonth >= 28) || (shift < 0 && dayOfMonth >= 29);
        if (unsupported)
          expect(() => scheduleToCron(schedule, reference)).toThrow(RangeError);
        else
          expect(
            parseCron(scheduleToCron(schedule, reference), reference)
          ).toMatchObject(schedule);
      }
    }
  });

  it('round-trips a one-time local New Year using its actual UTC year', () => {
    const date = new Date(2027, 0, 1, 0, 15);
    const schedule = { frequency: 'once' as const, hour: 0, minute: 15, date };
    const cron = scheduleToCron(schedule);
    const trigger = {
      custom_cron_expression: cron,
      config: { date: date.toISOString().slice(0, 10) },
    };
    expect(parseTriggerSchedule(trigger, new Date(2026, 11, 1))).toMatchObject(
      schedule
    );
    expect(getNextRun(trigger, new Date(2026, 11, 1))).toEqual(date);
  });

  it('finds the next last-day UTC run after a stale monthly timestamp', () => {
    const reference = new Date('2026-10-01T12:00:00Z');
    const localDate = new Date('2026-10-31T23:00:00Z');
    // L is the representation of local day 1 only when it crosses UTC midnight.
    if (localDate.getDate() === 1) {
      expect(
        getNextRun(
          {
            custom_cron_expression: '0 23 L * *',
            next_run_at: '2026-09-30T23:00:00Z',
          },
          reference
        )
      ).toEqual(new Date('2026-10-31T23:00:00Z'));
    }
  });

  it('retains the persisted year for a January one-time run configured in December', () => {
    const trigger = {
      custom_cron_expression: '0 9 5 1 *',
      config: { date: '2027-01-05' },
    };
    const reference = new Date('2026-12-15T12:00:00Z');
    expect(parseTriggerSchedule(trigger, reference)).toMatchObject({
      frequency: 'once',
      date: new Date('2027-01-05T09:00:00Z'),
    });
    expect(getNextRun(trigger, reference)).toEqual(
      new Date('2027-01-05T09:00:00Z')
    );
  });

  it('does not resurrect an expired one-time date from a future server placeholder', () => {
    expect(
      getNextRun(
        {
          custom_cron_expression: '0 9 5 1 *',
          config: { date: '2025-01-05' },
          next_run_at: '2027-01-05T09:00:00Z',
        },
        REFERENCE
      )
    ).toBeNull();
  });

  it('ignores a past scheduler next_run_at and calculates the next UTC slot', () => {
    const reference = new Date('2026-10-03T11:00:00Z');
    expect(
      getNextRun(
        {
          custom_cron_expression: '0 22 * * *',
          next_run_at: '2026-10-02T22:00:00Z',
        },
        reference
      )
    ).toEqual(new Date('2026-10-03T22:00:00Z'));
  });

  it('skips months without day 31 when previewing recurring schedules', () => {
    expect(
      nextOccurrence(
        { frequency: 'monthly', hour: 9, minute: 0, dayOfMonth: 31 },
        new Date(2026, 0, 31, 12)
      )
    ).toEqual(new Date(2026, 2, 31, 9));
  });

  it('uses the edited one-time hour rather than the date object original time', () => {
    expect(
      nextOccurrence(
        {
          frequency: 'once',
          hour: 18,
          minute: 30,
          date: new Date(2026, 6, 15, 9),
        },
        REFERENCE
      )
    ).toEqual(new Date(2026, 6, 15, 18, 30));
  });
});

describe('last-day monthly crons after a DST change', () => {
  // New Zealand is UTC+13 in January and UTC+12 in July.
  useTimeZone('Pacific/Auckland');
  const summer = () => new Date(2026, 0, 15, 12);
  const winter = () => new Date(2026, 6, 15, 12);
  const dayOne: RecurringSchedule = {
    frequency: 'monthly',
    hour: 0,
    minute: 30,
    dayOfMonth: 1,
  };

  it('reads a cron saved in summer as day 1 in winter', () => {
    const cron = scheduleToCron(dayOne, summer());
    expect(cron).toBe('30 11 L * *');
    expect(parseCron(cron, winter())).toEqual(dayOne);
  });

  it('keeps the current offset while it still reaches local day 1', () => {
    const cron = scheduleToCron(dayOne, winter());
    expect(cron).toBe('30 12 L * *');
    expect(parseCron(cron, summer())).toEqual({ ...dayOne, hour: 1 });
  });

  it('still shows when the server runs it', () => {
    const trigger = { custom_cron_expression: '30 11 L * *' };
    expect(parseTriggerSchedule(trigger, winter())).toEqual(dayOne);
    expect(getNextRun(trigger, winter())).toEqual(
      new Date('2026-07-31T11:30:00Z')
    );
  });

  it('does not invent a day for a last-day cron that never reaches day 1', () => {
    expect(parseCron('0 5 L * *', summer())).toBeNull();
    expect(parseCron('0 5 L * *', winter())).toBeNull();
  });
});
