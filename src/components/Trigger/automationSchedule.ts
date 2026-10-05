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

import { localTimeToUTC, utcTimeToLocal } from '@/lib/utils';
import type { Trigger } from '@/types';

export type RecurringSchedule = {
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday, in local time. */
  weekdays?: number[];
  dayOfMonth?: number;
};

export type LocalSchedule =
  | RecurringSchedule
  | { frequency: 'once'; hour: number; minute: number; date: Date };

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

type Translate = (key: string, options?: Record<string, unknown>) => string;

const pad = (n: number) => n.toString().padStart(2, '0');

/** Converts a local-time schedule into the UTC cron the trigger API stores. */
export function scheduleToCron(
  schedule: RecurringSchedule,
  reference: Date = new Date()
): string {
  const { utcHour, utcMinute, dayOffset } = localTimeToUTC(
    schedule.hour,
    schedule.minute,
    reference
  );
  if (schedule.frequency === 'weekly') {
    const days = (schedule.weekdays ?? [1]).map(
      (day) => (day + dayOffset + 7) % 7
    );
    return `${utcMinute} ${utcHour} * * ${days.join(',')}`;
  }
  if (schedule.frequency === 'monthly') {
    const day = Math.min(
      31,
      Math.max(1, (schedule.dayOfMonth ?? 1) + dayOffset)
    );
    return `${utcMinute} ${utcHour} ${day} * *`;
  }
  return `${utcMinute} ${utcHour} * * *`;
}

export function isOneTimeCron(cron?: string): boolean {
  const parts = cron?.trim().split(/\s+/) ?? [];
  return (
    parts.length === 5 &&
    parts[2] !== '*' &&
    parts[3] !== '*' &&
    parts[4] === '*'
  );
}

/** Parses the UTC cron shapes SchedulePicker produces back into local time. */
export function parseCron(
  cron?: string,
  reference: Date = new Date()
): LocalSchedule | null {
  const parts = cron?.trim().split(/\s+/) ?? [];
  if (parts.length !== 5) return null;
  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  if (!/^\d+$/.test(minutePart) || !/^\d+$/.test(hourPart)) return null;
  const utcMinute = Number(minutePart);
  const utcHour = Number(hourPart);

  if (isOneTimeCron(cron)) {
    const date = new Date(
      Date.UTC(
        reference.getFullYear(),
        Number(monthPart) - 1,
        Number(dayPart),
        utcHour,
        utcMinute
      )
    );
    return {
      frequency: 'once',
      hour: date.getHours(),
      minute: date.getMinutes(),
      date,
    };
  }

  const { localHour, localMinute, dayOffset } = utcTimeToLocal(
    utcHour,
    utcMinute,
    reference
  );
  const base = { hour: localHour, minute: localMinute };

  if (dayPart === '*' && monthPart === '*' && weekdayPart === '*') {
    return { frequency: 'daily', ...base };
  }
  if (dayPart === '*' && monthPart === '*') {
    const weekdays = weekdayPart
      .split(',')
      .filter((value) => /^\d+$/.test(value))
      .map((value) => (Number(value) + dayOffset + 7) % 7);
    return weekdays.length > 0
      ? { frequency: 'weekly', ...base, weekdays }
      : null;
  }
  if (/^\d+$/.test(dayPart) && monthPart === '*' && weekdayPart === '*') {
    const dayOfMonth = Math.min(31, Math.max(1, Number(dayPart) + dayOffset));
    return { frequency: 'monthly', ...base, dayOfMonth };
  }
  return null;
}

export function formatScheduleLabel(
  schedule: LocalSchedule,
  t: Translate,
  locale?: string
): string {
  const time = `${pad(schedule.hour)}:${pad(schedule.minute)}`;
  switch (schedule.frequency) {
    case 'daily':
      return t('triggers.schedule-label-daily', { time });
    case 'weekly': {
      const mondayFirst = [...(schedule.weekdays ?? [])].sort(
        (a, b) => ((a + 6) % 7) - ((b + 6) % 7)
      );
      const days = mondayFirst
        .map((day) => t(`triggers.weekday-${WEEKDAY_KEYS[day]}`))
        .join(', ');
      return t('triggers.schedule-label-weekly', { days, time });
    }
    case 'monthly':
      return t('triggers.schedule-label-monthly', {
        day: schedule.dayOfMonth ?? 1,
        time,
      });
    case 'once':
      return t('triggers.schedule-label-once', {
        date: schedule.date.toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
        }),
        time,
      });
  }
}

export function nextOccurrence(
  schedule: LocalSchedule,
  from: Date = new Date()
): Date | null {
  if (schedule.frequency === 'once') {
    return schedule.date > from ? schedule.date : null;
  }
  for (let offset = 0; offset < 400; offset++) {
    const candidate = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + offset,
      schedule.hour,
      schedule.minute
    );
    if (candidate <= from) continue;
    if (schedule.frequency === 'daily') return candidate;
    if (
      schedule.frequency === 'weekly' &&
      (schedule.weekdays ?? []).includes(candidate.getDay())
    ) {
      return candidate;
    }
    if (
      schedule.frequency === 'monthly' &&
      candidate.getDate() === schedule.dayOfMonth
    ) {
      return candidate;
    }
  }
  return null;
}

/** Prefers the scheduler's own `next_run_at`; falls back to reading the cron. */
export function getNextRun(
  trigger: Pick<Trigger, 'next_run_at' | 'custom_cron_expression'>,
  from: Date = new Date()
): Date | null {
  if (trigger.next_run_at) {
    const date = new Date(trigger.next_run_at);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const schedule = parseCron(trigger.custom_cron_expression, from);
  return schedule ? nextOccurrence(schedule, from) : null;
}

/** Short local date and time, e.g. "Mon, Oct 5, 09:00". */
export function formatRunTime(value: Date | string, locale?: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** The time of day of a run, e.g. "09:30". */
export function formatTimeOfDay(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
