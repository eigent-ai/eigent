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
  isOneTimeTooFarAhead,
  parseCron,
  scheduleToCron,
} from '@/components/Trigger/automationSchedule';
import { localTimeToUTC } from '@/lib/utils';
import type { Trigger, TriggerInput, TriggerUpdate } from '@/types';
import { format } from 'date-fns';

type SubmittedSchedule = Pick<
  TriggerInput,
  'custom_cron_expression' | 'config'
>;

/**
 * A server must echo the zone; otherwise restore the legacy UTC contract.
 * The first save already stored wall-time fields without a zone, which the
 * server reads as UTC, so `undo` removes them when the rewrite fails.
 */
export async function confirmScheduleTimezone(
  saved: Trigger,
  submitted: SubmittedSchedule,
  update: (id: number, payload: TriggerUpdate) => Promise<Trigger>,
  undo: () => Promise<unknown>
): Promise<Trigger> {
  const zone = submitted.config?.timezone;
  if (!zone || saved.config?.timezone === zone) return saved;
  try {
    return await update(saved.id, legacyUtcSchedule(submitted, zone));
  } catch (error) {
    await undo().catch((undoError) =>
      console.error('Failed to undo the schedule:', undoError)
    );
    throw error;
  }
}

/** Builds the schedule the way SchedulePicker does without a zone. */
function legacyUtcSchedule(
  submitted: SubmittedSchedule,
  zone: string
): TriggerUpdate {
  // The legacy contract converts with this machine's offset.
  if (zone !== Intl.DateTimeFormat().resolvedOptions().timeZone)
    throw new Error('Schedule could not be saved by this server');
  const config = { ...submitted.config };
  delete config.timezone;
  const schedule = parseCron(
    submitted.custom_cron_expression,
    new Date(),
    config.date,
    zone
  );
  if (
    !schedule ||
    (schedule.frequency === 'once' && isOneTimeTooFarAhead(schedule))
  )
    throw new Error('Schedule could not be saved by this server');
  // Throws for a monthly day a single UTC cron cannot repeat on.
  const cron = scheduleToCron(schedule);
  const utcDate = (localDate: Date) => {
    const date = new Date(localDate);
    const { dayOffset } = localTimeToUTC(schedule.hour, schedule.minute, date);
    date.setDate(date.getDate() + dayOffset);
    return format(date, 'yyyy-MM-dd');
  };
  if (schedule.frequency === 'once') config.date = utcDate(schedule.date);
  if (config.expirationDate)
    config.expirationDate = utcDate(
      new Date(`${config.expirationDate.slice(0, 10)}T00:00:00`)
    );
  return { custom_cron_expression: cron, config };
}
