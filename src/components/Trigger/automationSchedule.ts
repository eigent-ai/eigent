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
  schedule: LocalSchedule,
  reference: Date = new Date()
): string {
  if (schedule.frequency === 'once') {
    const date = new Date(schedule.date);
    date.setHours(schedule.hour, schedule.minute, 0, 0);
    return `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
  }
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
    const shiftedDay = (schedule.dayOfMonth ?? 1) + dayOffset;
    // The day before local day 1 is the UTC month's last day, not day 1 or 30.
    const day = shiftedDay === 0 ? 'L' : shiftedDay;
    const localDay = schedule.dayOfMonth ?? 1;
    // Short months make these shifts add or lose runs; a single UTC cron
    // cannot express both the local day and the source month's length.
    if (
      (dayOffset > 0 && localDay >= 28) ||
      (dayOffset < 0 && localDay >= 29)
    ) {
      throw new RangeError(
        'This monthly time cannot repeat on the selected day'
      );
    }
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
  reference: Date = new Date(),
  oneTimeDate?: string
): LocalSchedule | null {
  const parts = cron?.trim().split(/\s+/) ?? [];
  if (parts.length !== 5) return null;
  const [minutePart, hourPart, dayPart, monthPart, weekdayPart] = parts;
  if (!/^\d+$/.test(minutePart) || !/^\d+$/.test(hourPart)) return null;
  const utcMinute = Number(minutePart);
  const utcHour = Number(hourPart);

  if (isOneTimeCron(cron)) {
    // config.date is the persisted UTC date; cron cannot retain its year.
    const persistedYear = oneTimeDate?.match(
      /^(\d{4})-\d{2}-\d{2}(?:$|T)/
    )?.[1];
    const date = new Date(
      Date.UTC(
        persistedYear ? Number(persistedYear) : reference.getUTCFullYear(),
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
  if (
    (/^\d+$/.test(dayPart) || dayPart === 'L') &&
    monthPart === '*' &&
    weekdayPart === '*'
  ) {
    if (dayPart === 'L' && dayOffset !== 1) return null;
    const shiftedDay = Number(dayPart) + dayOffset;
    const dayOfMonth = dayPart === 'L' ? 1 : shiftedDay === 0 ? 31 : shiftedDay;
    return { frequency: 'monthly', ...base, dayOfMonth };
  }
  return null;
}

/** Use the stored UTC year for one-time schedules everywhere they are presented. */
export function parseTriggerSchedule(
  trigger: Pick<Trigger, 'custom_cron_expression' | 'config' | 'next_run_at'>,
  reference: Date = new Date()
): LocalSchedule | null {
  return parseCron(
    trigger.custom_cron_expression,
    reference,
    trigger.config?.date || trigger.next_run_at
  );
}

export function formatScheduleLabel(
  schedule: LocalSchedule,
  t: Translate,
  locale?: string
): string {
  const time = formatScheduleTime(schedule);
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
    const date = new Date(schedule.date);
    date.setHours(schedule.hour, schedule.minute, 0, 0);
    return date > from ? date : null;
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

/** Prefer a future scheduler time; calculate fallbacks in UTC, as the server does. */
export function getNextRun(
  trigger: Pick<Trigger, 'next_run_at' | 'custom_cron_expression' | 'config'>,
  from: Date = new Date()
): Date | null {
  const schedule = parseTriggerSchedule(trigger, from);
  if (schedule?.frequency === 'once') return nextOccurrence(schedule, from);
  if (trigger.next_run_at) {
    const date = new Date(trigger.next_run_at);
    if (!Number.isNaN(date.getTime()) && date > from) return date;
  }
  if (!schedule) return null;
  const [minute, hour, day, , weekdays] = trigger
    .custom_cron_expression!.trim()
    .split(/\s+/);
  for (let offset = 0; offset < 400; offset++) {
    const candidate = new Date(
      Date.UTC(
        from.getUTCFullYear(),
        from.getUTCMonth(),
        from.getUTCDate() + offset,
        Number(hour),
        Number(minute)
      )
    );
    if (candidate <= from) continue;
    if (schedule.frequency === 'daily') return candidate;
    if (
      schedule.frequency === 'weekly' &&
      weekdays
        .split(',')
        .map(Number)
        .some((value) => value % 7 === candidate.getUTCDay())
    )
      return candidate;
    const lastDay = new Date(
      Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)
    ).getUTCDate();
    if (
      schedule.frequency === 'monthly' &&
      candidate.getUTCDate() === (day === 'L' ? lastDay : Number(day))
    )
      return candidate;
  }
  return null;
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
  return formatScheduleTime({
    hour: date.getHours(),
    minute: date.getMinutes(),
  });
}

export function formatScheduleTime(
  schedule: Pick<LocalSchedule, 'hour' | 'minute'>
): string {
  return `${pad(schedule.hour)}:${pad(schedule.minute)}`;
}
