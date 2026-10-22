import {
  nextOccurrenceInZone,
  parseCron,
} from '@/components/Trigger/automationSchedule';
import type { Trigger, TriggerInput, TriggerUpdate } from '@/types';

/** A server must echo the zone; otherwise restore the legacy UTC contract. */
export async function confirmScheduleTimezone(
  saved: Trigger,
  submitted: Pick<TriggerInput, 'custom_cron_expression' | 'config'>,
  update: (id: number, payload: TriggerUpdate) => Promise<Trigger>
): Promise<Trigger> {
  const zone = submitted.config?.timezone;
  if (!zone || saved.config?.timezone === zone) return saved;
  const config = { ...submitted.config };
  delete config.timezone;
  const now = new Date();
  const schedule = parseCron(
    submitted.custom_cron_expression,
    now,
    config.date,
    zone
  );
  const next = schedule && nextOccurrenceInZone(schedule, zone, now);
  if (!schedule || !next)
    throw new Error('Schedule could not be saved by this server');
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(next);
  const local = new Date(`${localDate}T00:00:00Z`);
  const utcDay = Date.UTC(
    next.getUTCFullYear(),
    next.getUTCMonth(),
    next.getUTCDate()
  );
  const shift = Math.round((utcDay - local.getTime()) / 86400000);
  let day = '*',
    month = '*',
    weekdays = '*';
  if (schedule.frequency === 'once') {
    day = String(next.getUTCDate());
    month = String(next.getUTCMonth() + 1);
    config.date = next.toISOString().slice(0, 10);
  } else if (schedule.frequency === 'weekly') {
    weekdays = (schedule.weekdays ?? [1])
      .map((value) => (value + shift + 7) % 7)
      .join(',');
  } else if (schedule.frequency === 'monthly') {
    const shifted = (schedule.dayOfMonth ?? 1) + shift;
    day = shifted === 0 ? 'L' : String(shifted);
  }
  if (config.expirationDate && shift) {
    const expiration = new Date(`${config.expirationDate}T00:00:00Z`);
    expiration.setUTCDate(expiration.getUTCDate() + shift);
    config.expirationDate = expiration.toISOString().slice(0, 10);
  }
  return update(saved.id, {
    custom_cron_expression: `${next.getUTCMinutes()} ${next.getUTCHours()} ${day} ${month} ${weekdays}`,
    config,
  });
}
