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

// An ISO 8601 date-time without `Z` or a UTC offset, for example
// "2026-10-08T04:00:00" or "2026-10-08 04:00:00.123456".
const DATE_TIME_WITHOUT_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/**
 * Convert a timestamp received from the API to epoch milliseconds.
 *
 * The API stores UTC datetimes without timezone information and serializes
 * them without a designator (for example "2026-10-08T04:00:00.123456").
 * `new Date()` reads such strings as local time, which shifts them by the
 * viewer's UTC offset, so they are read as UTC here. Strings that carry `Z`
 * or an explicit offset keep their meaning, and numbers are already epoch
 * milliseconds.
 *
 * Returns `NaN` for a missing or unparseable value.
 */
export function parseServerTimestamp(
  value: string | number | null | undefined
): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : Number.NaN;
  }
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim();
  if (!text) return Number.NaN;
  if (DATE_TIME_WITHOUT_TIMEZONE.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}Z`);
  }
  return Date.parse(text);
}
