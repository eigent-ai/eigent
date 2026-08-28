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

import { clsx, type ClassValue } from 'clsx';
import { format, parseISO } from 'date-fns';
import i18next from 'i18next';
import { extendTailwindMerge } from 'tailwind-merge';

const mergeTailwindClasses = extendTailwindMerge({
  extend: {
    theme: {
      // Tailwind Merge cannot infer that these custom `text-*` utilities are
      // font sizes. Registering the semantic roles keeps them from evicting
      // semantic foreground colors such as `text-ds-ink-inverse`.
      text: [
        'ds-text-meta',
        'ds-text-base',
        'ds-text-body-large',
        'ds-text-title',
        'ds-text-section',
        'ds-text-page',
        'ds-text-display',
        'ds-code-small',
        'ds-code-base',
        'ds-code-large',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return mergeTailwindClasses(clsx(inputs));
}

function currentLocale(): string {
  return i18next.resolvedLanguage || i18next.language || 'en-US';
}

function notAvailable(): string {
  return i18next.t('layout.not-available', { defaultValue: 'N/A' });
}

/**
 * Date/Time Utilities
 * All functions expect UTC ISO strings from API and convert to local timezone
 */

/**
 * Format UTC timestamp to local time (HH:mm:ss)
 * @param utcString - ISO 8601 UTC timestamp from API
 */
export function formatTime(utcString: string | null | undefined): string {
  if (!utcString) return notAvailable();
  try {
    const date = parseISO(
      utcString.endsWith('Z') ? utcString : utcString + 'Z'
    );
    return format(date, 'HH:mm:ss');
  } catch {
    return i18next.t('layout.invalid-time', {
      defaultValue: 'Invalid time',
    });
  }
}

/**
 * Format UTC timestamp to local date and time
 * @param utcString - ISO 8601 UTC timestamp from API
 * @param formatStr - date-fns format string (default: "MMM dd, yyyy HH:mm")
 */
export function formatDateTime(
  utcString: string | null | undefined,
  formatStr: string = 'MMM dd, yyyy HH:mm'
): string {
  if (!utcString) return notAvailable();
  try {
    const date = parseISO(
      utcString.endsWith('Z') ? utcString : utcString + 'Z'
    );
    if (formatStr === 'MMM dd, yyyy HH:mm') {
      return new Intl.DateTimeFormat(currentLocale(), {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    }
    return format(date, formatStr);
  } catch {
    return i18next.t('layout.invalid-date', {
      defaultValue: 'Invalid date',
    });
  }
}

/**
 * Format UTC timestamp to local date only
 * @param utcString - ISO 8601 UTC timestamp from API
 */
export function formatDate(utcString: string | null | undefined): string {
  if (!utcString) return notAvailable();
  try {
    const date = parseISO(
      utcString.endsWith('Z') ? utcString : utcString + 'Z'
    );
    return new Intl.DateTimeFormat(currentLocale(), {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(date);
  } catch {
    return i18next.t('layout.invalid-date', {
      defaultValue: 'Invalid date',
    });
  }
}

/**
 * Format UTC timestamp as relative time (e.g., "2 hours ago")
 * @param utcString - ISO 8601 UTC timestamp from API
 */
export function formatRelativeTime(
  utcString: string | null | undefined
): string {
  if (!utcString) return notAvailable();
  try {
    const date = parseISO(
      utcString.endsWith('Z') ? utcString : utcString + 'Z'
    );
    const seconds = (date.getTime() - Date.now()) / 1000;
    const absoluteSeconds = Math.abs(seconds);
    let value: number;
    let unit: Intl.RelativeTimeFormatUnit;
    if (absoluteSeconds < 60) {
      value = Math.round(seconds);
      unit = 'second';
    } else if (absoluteSeconds < 60 * 60) {
      value = Math.round(seconds / 60);
      unit = 'minute';
    } else if (absoluteSeconds < 60 * 60 * 24) {
      value = Math.round(seconds / (60 * 60));
      unit = 'hour';
    } else if (absoluteSeconds < 60 * 60 * 24 * 30) {
      value = Math.round(seconds / (60 * 60 * 24));
      unit = 'day';
    } else if (absoluteSeconds < 60 * 60 * 24 * 365) {
      value = Math.round(seconds / (60 * 60 * 24 * 30));
      unit = 'month';
    } else {
      value = Math.round(seconds / (60 * 60 * 24 * 365));
      unit = 'year';
    }
    return new Intl.RelativeTimeFormat(currentLocale(), {
      numeric: 'always',
    }).format(value, unit);
  } catch {
    return i18next.t('layout.invalid-date', {
      defaultValue: 'Invalid date',
    });
  }
}

/**
 * Convert local time to UTC with day offset calculation
 */
export function localTimeToUTC(
  localHour: number,
  localMinute: number,
  referenceDate?: Date
): {
  utcHour: number;
  utcMinute: number;
  dayOffset: number;
} {
  const date = referenceDate ? new Date(referenceDate) : new Date();
  date.setHours(localHour, localMinute, 0, 0);

  const utcHour = date.getUTCHours();
  const utcMinute = date.getUTCMinutes();
  const localDay = date.getDate();
  const utcDay = date.getUTCDate();
  const dayOffset = utcDay - localDay;

  return { utcHour, utcMinute, dayOffset };
}

/**
 * Convert UTC time to local with day offset calculation
 */
export function utcTimeToLocal(
  utcHour: number,
  utcMinute: number,
  referenceDate?: Date
): {
  localHour: number;
  localMinute: number;
  dayOffset: number;
} {
  const date = referenceDate ? new Date(referenceDate) : new Date();
  date.setUTCHours(utcHour, utcMinute, 0, 0);

  const localHour = date.getHours();
  const localMinute = date.getMinutes();
  const utcDay = date.getUTCDate();
  const localDay = date.getDate();
  const dayOffset = localDay - utcDay;

  return { localHour, localMinute, dayOffset };
}
