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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import {
  InputSelect,
  type InputSelectOption,
} from '@/components/ui/input-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn, localTimeToUTC } from '@/lib/utils';
import { addYears, format, parse, subDays } from 'date-fns';
import { Clock, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatRunTime,
  getNextRun,
  isOneTimeTooFarAhead,
  nextOccurrence,
  parseCron,
  scheduleToCron,
  type LocalSchedule,
} from './automationSchedule';

type FrequencyType = 'one-time' | 'daily' | 'weekly' | 'monthly';

export type ScheduleConfig = {
  date?: string; // YYYY-MM-DD format for one-time schedules
  expirationDate?: string; // YYYY-MM-DD format for recurring expiration
  max_failure_count?: number;
};

type SchedulePickerProps = {
  value: string; // cron expression
  onChange: (cronExpression: string) => void;
  onConfigChange?: (config: ScheduleConfig) => void;
  onValidationChange?: (isValid: boolean) => void;
  showErrors?: boolean;
  initialConfig?: ScheduleConfig; // For editing existing triggers
  /** Editing an existing automation: the preview reads "Next run". */
  isEditing?: boolean;
  /** Only a blank create form treats the default cron as unchosen. */
  useDefaultTime?: boolean;
};

/** New schedules start at the next full hour so the first run is never already past. */
const nextFullHour = (): Date => {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return date;
};

// Generate hour options (0-23)
const generateHourOptions = (): InputSelectOption[] => {
  return Array.from({ length: 24 }, (_, i) => {
    const value = i.toString().padStart(2, '0');
    return {
      value: value,
      label: value,
    };
  });
};

// Generate minute options (0-59)
const generateMinuteOptions = (): InputSelectOption[] => {
  return Array.from({ length: 60 }, (_, i) => {
    const value = i.toString().padStart(2, '0');
    return {
      value: value,
      label: value,
    };
  });
};

export const SchedulePicker: React.FC<SchedulePickerProps> = ({
  value,
  onChange,
  onConfigChange,
  onValidationChange,
  showErrors = false,
  initialConfig,
  isEditing = false,
  useDefaultTime = false,
}) => {
  const { t, i18n } = useTranslation();
  // A stored schedule the editor cannot show selects no frequency, so it is
  // kept until the user picks one.
  const [frequency, setFrequency] = useState<FrequencyType | null>(() =>
    value && !parseCron(value, new Date(), initialConfig?.date) ? null : 'daily'
  );
  const [defaultStart] = useState(nextFullHour);
  const [hour, setHour] = useState<string>(
    defaultStart.getHours().toString().padStart(2, '0')
  );
  const [minute, setMinute] = useState<string>('00');
  const [weekdays, setWeekdays] = useState<string[]>(['1']); // Array of weekday strings: ["0", "1", ...]
  const [dayOfMonth, setDayOfMonth] = useState<string>('1'); // 1-31
  const [oneTimeDate, setOneTimeDate] = useState<Date | undefined>(
    () => new Date(defaultStart)
  );
  const [expiredAt, setExpiredAt] = useState<Date | undefined>(undefined);
  const [maxFailureCount, setMaxFailureCount] = useState<number | undefined>(5);

  const hourOptions = useMemo(() => generateHourOptions(), []);
  const minuteOptions = useMemo(() => generateMinuteOptions(), []);
  const previousCronRef = useRef<string>('');
  const originalSchedule = useRef(
    parseCron(value, new Date(), initialConfig?.date)
  ).current;

  // One-time dates are initialized from the shared parser with the persisted UTC year.
  useEffect(() => {
    if (initialConfig?.expirationDate) {
      setExpiredAt(
        parse(initialConfig.expirationDate, 'yyyy-MM-dd', new Date())
      );
    }
    if (initialConfig?.max_failure_count !== undefined) {
      setMaxFailureCount(initialConfig.max_failure_count);
    }
  }, [initialConfig]);

  // The picker, examples and details share the same UTC conversion contract.
  useEffect(() => {
    if (!value || value === previousCronRef.current) return;
    const parsed = parseCron(value, new Date(), initialConfig?.date);
    if (!parsed) {
      setFrequency(null);
    } else if (!(useDefaultTime && value === '0 0 * * *')) {
      setFrequency(parsed.frequency === 'once' ? 'one-time' : parsed.frequency);
      setHour(String(parsed.hour).padStart(2, '0'));
      setMinute(String(parsed.minute).padStart(2, '0'));
      if (parsed.frequency === 'once') setOneTimeDate(parsed.date);
      if (parsed.frequency === 'weekly')
        setWeekdays((parsed.weekdays ?? []).map(String));
      if (parsed.frequency === 'monthly')
        setDayOfMonth(String(parsed.dayOfMonth));
    }
    previousCronRef.current = value;
  }, [value, useDefaultTime, initialConfig?.date]);

  const selectedSchedule = useMemo<LocalSchedule | null>(() => {
    if (!frequency || !hour || !minute) return null;
    const time = { hour: Number(hour), minute: Number(minute) };
    if (frequency === 'one-time')
      return oneTimeDate
        ? { frequency: 'once', ...time, date: oneTimeDate }
        : null;
    if (frequency === 'weekly')
      return weekdays.length
        ? { frequency, ...time, weekdays: weekdays.map(Number) }
        : null;
    if (frequency === 'monthly')
      return dayOfMonth
        ? { frequency, ...time, dayOfMonth: Number(dayOfMonth) }
        : null;
    return { frequency, ...time };
  }, [frequency, hour, minute, weekdays, dayOfMonth, oneTimeDate]);

  let cron: string | null = null;
  if (selectedSchedule) {
    try {
      cron = scheduleToCron(selectedSchedule);
    } catch {
      /* Cannot represent this local monthly day in a UTC cron. */
    }
  }
  const unsupportedMonthlyTime =
    selectedSchedule?.frequency === 'monthly' && !cron;

  useEffect(() => {
    if (cron && cron !== previousCronRef.current) {
      previousCronRef.current = cron;
      onChange(cron);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron]); // onChange is supplied inline by the owning form.

  // Emit config with YYYY-MM-DD format to match backend
  useEffect(() => {
    const config: ScheduleConfig = {};

    if (frequency === null) {
      // The kept schedule keeps its stored dates too.
      if (initialConfig?.date) config.date = initialConfig.date;
      if (initialConfig?.expirationDate)
        config.expirationDate = initialConfig.expirationDate;
    }

    if (frequency === 'one-time' && oneTimeDate) {
      // Apply UTC dayOffset so config.date matches the UTC date in the cron expression
      const { dayOffset } = localTimeToUTC(
        parseInt(hour),
        parseInt(minute),
        oneTimeDate
      );
      const utcDate = new Date(oneTimeDate);
      utcDate.setDate(utcDate.getDate() + dayOffset);
      config.date = format(utcDate, 'yyyy-MM-dd');
    }

    if (frequency !== null && expiredAt) {
      // Apply UTC dayOffset so expiration date aligns with the UTC date the cron actually fires on.
      // e.g. if local 23:00 in UTC-5 becomes 04:00 UTC next day (dayOffset=+1),
      // the "last allowed UTC run date" must also shift forward by 1.
      const { dayOffset } = localTimeToUTC(
        parseInt(hour),
        parseInt(minute),
        expiredAt
      );
      const utcExpiredAt = new Date(expiredAt);
      utcExpiredAt.setDate(utcExpiredAt.getDate() + dayOffset);
      config.expirationDate = format(utcExpiredAt, 'yyyy-MM-dd');
    }

    if (maxFailureCount !== undefined) {
      config.max_failure_count = maxFailureCount;
    }

    onConfigChange?.(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, oneTimeDate, expiredAt, maxFailureCount, hour, minute]);

  const oneTimeTooFarAhead =
    selectedSchedule?.frequency === 'once' &&
    isOneTimeTooFarAhead(selectedSchedule);

  const nextScheduledTimes = useMemo(() => {
    // The server would not use a date a year or more ahead; do not preview it.
    if (!selectedSchedule || !cron || oneTimeTooFarAhead) return [];
    const times: Date[] = [];
    let cursor = new Date();
    for (let index = 0; index < 5; index++) {
      const next =
        selectedSchedule.frequency === 'once'
          ? nextOccurrence(selectedSchedule, cursor)
          : getNextRun({ custom_cron_expression: cron }, cursor);
      if (!next) break;
      times.push(next);
      cursor = next;
    }
    return times;
  }, [selectedSchedule, cron, oneTimeTooFarAhead]);

  const firstRun = unsupportedMonthlyTime
    ? null
    : (nextScheduledTimes.at(0) ?? null);
  const selectedOneTimeDate =
    selectedSchedule?.frequency === 'once'
      ? new Date(selectedSchedule.date)
      : null;
  selectedOneTimeDate?.setHours(Number(hour), Number(minute), 0, 0);
  const unchangedPastOneTime =
    !oneTimeTooFarAhead &&
    isEditing &&
    originalSchedule?.frequency === 'once' &&
    selectedOneTimeDate?.getTime() === originalSchedule.date.getTime();
  const keepsStoredSchedule = frequency === null;
  const validSchedule =
    keepsStoredSchedule ||
    (!!selectedSchedule &&
      !unsupportedMonthlyTime &&
      (firstRun !== null || unchangedPastOneTime));
  const noticeIsInformation =
    !!firstRun || unchangedPastOneTime || keepsStoredSchedule;
  useEffect(() => {
    onValidationChange?.(validSchedule);
  }, [validSchedule, onValidationChange]);

  // Format date for display
  const formatScheduledTime = (date: Date): string => {
    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    });
  };

  const dayOfMonthOptions: InputSelectOption[] = useMemo(() => {
    const pr = new Intl.PluralRules('en-US', { type: 'ordinal' });
    const suffixes: Record<string, string> = {
      one: 'st',
      two: 'nd',
      few: 'rd',
      other: 'th',
    };

    return Array.from({ length: 31 }, (_, i) => {
      const day = i + 1;
      const rule = pr.select(day);
      const suffix = suffixes[rule];
      return {
        value: day.toString(),
        label: `${day}${suffix}`,
      };
    });
  }, []);

  return (
    <div className="flex h-full w-full min-w-0 flex-col space-y-4">
      <Tabs
        value={frequency ?? ''}
        // Moving focus through the tabs must not replace a kept schedule.
        activationMode={keepsStoredSchedule ? 'manual' : 'automatic'}
        onValueChange={(value) => setFrequency(value as FrequencyType)}
        className="min-w-0 flex-1"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="one-time" className="text-ds-text-base">
            {t('triggers.frequency-one-time')}
          </TabsTrigger>
          <TabsTrigger value="daily" className="text-ds-text-base">
            {t('triggers.frequency-daily')}
          </TabsTrigger>
          <TabsTrigger value="weekly" className="text-ds-text-base">
            {t('triggers.frequency-weekly')}
          </TabsTrigger>
          <TabsTrigger value="monthly" className="text-ds-text-base">
            {t('triggers.frequency-monthly')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="one-time" className="mt-4 space-y-3">
          <Input
            aria-label={t('triggers.schedule-date')}
            type="date"
            title={t('triggers.schedule-date')}
            value={oneTimeDate ? format(oneTimeDate, 'yyyy-MM-dd') : ''}
            onChange={(e) => {
              const val = e.target.value;
              setOneTimeDate(
                val ? parse(val, 'yyyy-MM-dd', new Date()) : undefined
              );
            }}
            placeholder={t('triggers.select-date')}
            min={format(
              isEditing &&
                originalSchedule?.frequency === 'once' &&
                originalSchedule.date < new Date()
                ? originalSchedule.date
                : new Date(),
              'yyyy-MM-dd'
            )}
            max={format(subDays(addYears(new Date(), 1), 1), 'yyyy-MM-dd')}
            required
            state={showErrors && !oneTimeDate ? 'error' : 'default'}
            note={
              showErrors && !oneTimeDate
                ? t('triggers.date-required')
                : undefined
            }
          />
          <div className="grid min-w-0 grid-cols-2 items-end gap-3">
            <div className="min-w-0">
              <InputSelect
                value={hour}
                onChange={(value) => setHour(value)}
                options={hourOptions}
                title={t('triggers.schedule-hour')}
                placeholder="00"
                required
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !hour ? 'error' : undefined}
              />
            </div>
            <div className="min-w-0">
              <InputSelect
                value={minute}
                onChange={(value) => setMinute(value)}
                options={minuteOptions}
                title={t('triggers.schedule-minute')}
                placeholder="00"
                required
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !minute ? 'error' : undefined}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="daily" className="mt-4 space-y-3">
          <div className="grid min-w-0 grid-cols-2 items-end gap-3">
            <div className="min-w-0">
              <InputSelect
                value={hour}
                onChange={(value) => setHour(value)}
                options={hourOptions}
                title={t('triggers.schedule-hour')}
                placeholder="00"
                required
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !hour ? 'error' : undefined}
              />
            </div>
            <div className="min-w-0">
              <InputSelect
                value={minute}
                onChange={(value) => setMinute(value)}
                options={minuteOptions}
                title={t('triggers.schedule-minute')}
                placeholder="00"
                required
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !minute ? 'error' : undefined}
              />
            </div>
          </div>
          <Input
            type="date"
            title={t('triggers.expiration-date')}
            value={expiredAt ? format(expiredAt, 'yyyy-MM-dd') : ''}
            onChange={(e) => {
              const val = e.target.value;
              setExpiredAt(
                val ? parse(val, 'yyyy-MM-dd', new Date()) : undefined
              );
            }}
            placeholder={t('triggers.select-expiration')}
            min={format(new Date(), 'yyyy-MM-dd')}
            optional
          />
        </TabsContent>

        <TabsContent value="weekly" className="mt-4 space-y-3">
          <div className="grid min-w-0 grid-cols-2 items-end gap-3">
            <div className="min-w-0">
              <InputSelect
                value={hour}
                onChange={(value) => setHour(value)}
                options={hourOptions}
                title={t('triggers.schedule-hour')}
                placeholder="00"
                required
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !hour ? 'error' : undefined}
              />
            </div>
            <div className="min-w-0">
              <InputSelect
                value={minute}
                onChange={(value) => setMinute(value)}
                options={minuteOptions}
                title={t('triggers.schedule-minute')}
                placeholder="00"
                required
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !minute ? 'error' : undefined}
              />
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-ds-text-meta font-bold text-ds-ink-default-default">
              {t('triggers.schedule-weekdays')} *
            </div>
            <ToggleGroup
              type="multiple"
              value={weekdays}
              onValueChange={(values) => {
                // Ensure at least one weekday is always selected
                if (values.length > 0) {
                  setWeekdays(values);
                } else {
                  // If trying to deselect all, keep the current selection
                  // This prevents having no weekdays selected
                }
              }}
              className="flex flex-wrap gap-2"
            >
              <ToggleGroupItem
                value="0"
                className="flex-1"
                aria-label={t('triggers.weekday-sunday')}
              >
                {t('triggers.weekday-sunday')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="1"
                className="flex-1"
                aria-label={t('triggers.weekday-monday')}
              >
                {t('triggers.weekday-monday')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="2"
                className="flex-1"
                aria-label={t('triggers.weekday-tuesday')}
              >
                {t('triggers.weekday-tuesday')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="3"
                className="flex-1"
                aria-label={t('triggers.weekday-wednesday')}
              >
                {t('triggers.weekday-wednesday')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="4"
                className="flex-1"
                aria-label={t('triggers.weekday-thursday')}
              >
                {t('triggers.weekday-thursday')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="5"
                className="flex-1"
                aria-label={t('triggers.weekday-friday')}
              >
                {t('triggers.weekday-friday')}
              </ToggleGroupItem>
              <ToggleGroupItem
                value="6"
                className="flex-1"
                aria-label={t('triggers.weekday-saturday')}
              >
                {t('triggers.weekday-saturday')}
              </ToggleGroupItem>
            </ToggleGroup>
            {showErrors && weekdays.length === 0 && (
              <div className="mt-1 text-xs text-ds-text-status-error-strong-default">
                {t('triggers.weekday-required')}
              </div>
            )}
          </div>
          <Input
            type="date"
            title={t('triggers.expiration-date')}
            value={expiredAt ? format(expiredAt, 'yyyy-MM-dd') : ''}
            onChange={(e) => {
              const val = e.target.value;
              setExpiredAt(
                val ? parse(val, 'yyyy-MM-dd', new Date()) : undefined
              );
            }}
            placeholder={t('triggers.select-expiration')}
            min={format(new Date(), 'yyyy-MM-dd')}
            optional
          />
        </TabsContent>

        <TabsContent value="monthly" className="mt-4 space-y-3">
          <InputSelect
            value={dayOfMonth}
            onChange={(value) => setDayOfMonth(value)}
            options={dayOfMonthOptions}
            title={t('triggers.schedule-day-of-month')}
            placeholder={t('triggers.select-day')}
            note={t('triggers.schedule-day-of-month-note')}
            required
            state={showErrors && !dayOfMonth ? 'error' : undefined}
          />
          <div className="grid min-w-0 grid-cols-2 items-end gap-3">
            <div className="min-w-0">
              <InputSelect
                value={hour}
                onChange={(value) => setHour(value)}
                options={hourOptions}
                title={t('triggers.schedule-hour')}
                required
                placeholder="00"
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !hour ? 'error' : undefined}
              />
            </div>
            <div className="min-w-0">
              <InputSelect
                value={minute}
                onChange={(value) => setMinute(value)}
                options={minuteOptions}
                title={t('triggers.schedule-minute')}
                required
                placeholder="00"
                leadingIcon={<Clock className="h-4 w-4" />}
                state={showErrors && !minute ? 'error' : undefined}
              />
            </div>
          </div>
          <Input
            type="date"
            title={t('triggers.expiration-date')}
            value={expiredAt ? format(expiredAt, 'yyyy-MM-dd') : ''}
            onChange={(e) => {
              const val = e.target.value;
              setExpiredAt(
                val ? parse(val, 'yyyy-MM-dd', new Date()) : undefined
              );
            }}
            placeholder={t('triggers.select-expiration')}
            min={format(new Date(), 'yyyy-MM-dd')}
            optional
          />
        </TabsContent>
      </Tabs>

      <div
        role="status"
        className={cn(
          'flex items-start gap-ds-8 rounded-ds-field p-ds-12',
          noticeIsInformation
            ? 'bg-ds-bg-information-subtle-default'
            : 'bg-ds-bg-error-subtle-default'
        )}
      >
        <DsIcon
          icon={noticeIsInformation ? Clock : TriangleAlert}
          recipe="main"
          aria-hidden
          className={cn(
            'mt-ds-2',
            noticeIsInformation
              ? 'text-ds-icon-information-default-default'
              : 'text-ds-icon-error-default-default'
          )}
        />
        <DsText as="p" role="base">
          {firstRun
            ? t(
                isEditing
                  ? 'triggers.next-run-notice'
                  : 'triggers.first-run-notice',
                { time: formatRunTime(firstRun, i18n.language) }
              )
            : keepsStoredSchedule
              ? t('triggers.keeps-stored-schedule')
              : unsupportedMonthlyTime
                ? t('triggers.monthly-time-crosses-month')
                : oneTimeTooFarAhead
                  ? t('triggers.one-time-within-a-year')
                  : unchangedPastOneTime
                    ? t('triggers.no-upcoming-executions')
                    : t('triggers.pick-future-time')}
        </DsText>
      </div>

      {/* Max Failure Count - for auto-disable after consecutive failures */}
      <Input
        id="max_failure_count"
        title={t('triggers.base.max_failure_count.label')}
        placeholder={t('triggers.base.max_failure_count.placeholder')}
        note={t('triggers.base.max_failure_count.notice')}
        type="number"
        value={maxFailureCount ?? ''}
        onChange={(e) =>
          setMaxFailureCount(
            e.target.value ? parseInt(e.target.value) : undefined
          )
        }
        min={1}
        optional
      />

      {/* Scheduled Times Preview */}
      <Accordion type="single" collapsible className="mt-auto w-full">
        <AccordionItem value="scheduled-times" className="border-none">
          <AccordionTrigger className="bg-transparent py-2 hover:no-underline">
            <span className="text-sm font-bold text-ds-ink-default-default">
              {t('triggers.preview-scheduled-times')}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2 rounded-lg bg-ds-neutral-subtle-default p-4">
              {nextScheduledTimes.map((time, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 text-ds-text-base text-ds-ink-default-default"
                >
                  <span className="w-5 font-mono text-xs text-ds-ink-muted-default">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{formatScheduledTime(time)}</span>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
};
