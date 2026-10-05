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

import type { RecurringSchedule } from './automationSchedule';

/** Copy lives under `triggers.examples.<id>.{title,description,prompt}`. */
export type AutomationExample = {
  id: string;
  schedule: RecurringSchedule;
};

const daily = (hour: number): RecurringSchedule => ({
  frequency: 'daily',
  hour,
  minute: 0,
});
const weekly = (weekday: number, hour: number): RecurringSchedule => ({
  frequency: 'weekly',
  hour,
  minute: 0,
  weekdays: [weekday],
});

/** One shared set, in the same order, for every user. */
export const AUTOMATION_EXAMPLES: AutomationExample[] = [
  { id: 'meeting-prep-brief', schedule: daily(8) },
  { id: 'campaign-performance-recap', schedule: weekly(1, 9) },
  { id: 'hiring-pipeline-digest', schedule: weekly(5, 16) },
  { id: 'expense-report-review', schedule: daily(10) },
  { id: 'inbox-triage', schedule: daily(7) },
  { id: 'weekly-feature-usage-recap', schedule: weekly(1, 9) },
];
