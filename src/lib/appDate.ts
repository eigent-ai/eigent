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

import i18next from 'i18next';

/** Format a local date using the current app language, never the OS language. */
export function formatAppDate(
  date: Date,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  return new Intl.DateTimeFormat(
    locale || i18next.resolvedLanguage || i18next.language || 'en-US',
    options
  ).format(date);
}
