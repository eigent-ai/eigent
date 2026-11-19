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

import type { Meeting } from '@/service/meetingsApi';
import { differenceInCalendarDays, format } from 'date-fns';

export type MeetingGroupKind = 'today' | 'yesterday' | 'this-week' | 'month';

export interface MeetingGroup {
  /** Stable key: the kind, or `yyyy-MM` for a month. */
  key: string;
  kind: MeetingGroupKind;
  /** A date inside the group, for the month label. */
  sample: Date;
  meetings: Meeting[];
}

function groupFor(
  started: Date,
  now: Date
): Pick<MeetingGroup, 'key' | 'kind'> {
  const days = differenceInCalendarDays(now, started);
  if (days <= 0) return { key: 'today', kind: 'today' };
  if (days === 1) return { key: 'yesterday', kind: 'yesterday' };
  if (days < 7) return { key: 'this-week', kind: 'this-week' };
  return { key: format(started, 'yyyy-MM'), kind: 'month' };
}

/**
 * Group meetings by day: Today, Yesterday, This week, then by month (plan
 * §4.4). Groups and the meetings in them are newest first.
 */
export function groupMeetingsByDay(
  meetings: readonly Meeting[],
  now: Date
): MeetingGroup[] {
  const groups = new Map<string, MeetingGroup>();
  const sorted = [...meetings].sort((a, b) => b.started_at - a.started_at);
  for (const meeting of sorted) {
    const started = new Date(meeting.started_at * 1000);
    const { key, kind } = groupFor(started, now);
    const group = groups.get(key);
    if (group) {
      group.meetings.push(meeting);
    } else {
      groups.set(key, { key, kind, sample: started, meetings: [meeting] });
    }
  }
  return [...groups.values()];
}

/** `m:ss`, or `h:mm:ss` from an hour; the same format as the Space copy. */
export function formatMeetingDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/** Default title for a new recording: the date and time it starts. */
export function defaultMeetingTitle(now: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(now);
}
