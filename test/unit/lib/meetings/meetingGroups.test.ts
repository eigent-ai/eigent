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
  formatMeetingDuration,
  groupMeetingsByDay,
} from '@/lib/meetings/meetingGroups';
import type { Meeting } from '@/service/meetingsApi';
import { describe, expect, it } from 'vitest';

const at = (date: Date): Meeting => ({
  id: `meeting_${date.getTime()}`,
  title: date.toISOString(),
  status: 'ready',
  source: 'microphone',
  started_at: date.getTime() / 1000,
  ended_at: null,
  duration_ms: 0,
  recording_file: null,
  recording_bytes: 0,
  recording_kept: false,
  note_markdown: '',
  note_edited: false,
  typed_notes: [],
  spaces: [],
});

describe('groupMeetingsByDay', () => {
  const now = new Date(2026, 10, 19, 15, 0);

  it('groups by Today, Yesterday, This week, then month, newest first', () => {
    const today = at(new Date(2026, 10, 19, 9, 0));
    const yesterday = at(new Date(2026, 10, 18, 23, 30));
    const thisWeek = at(new Date(2026, 10, 14, 10, 0));
    const earlierNovember = at(new Date(2026, 10, 2, 10, 0));
    const october = at(new Date(2026, 9, 30, 10, 0));
    const octoberEarlier = at(new Date(2026, 9, 1, 10, 0));

    const groups = groupMeetingsByDay(
      [octoberEarlier, today, thisWeek, october, yesterday, earlierNovember],
      now
    );

    expect(groups.map((group) => group.key)).toEqual([
      'today',
      'yesterday',
      'this-week',
      '2026-11',
      '2026-10',
    ]);
    expect(groups.map((group) => group.kind)).toEqual([
      'today',
      'yesterday',
      'this-week',
      'month',
      'month',
    ]);
    expect(groups[4].meetings).toEqual([october, octoberEarlier]);
  });

  it('returns nothing for no meetings', () => {
    expect(groupMeetingsByDay([], now)).toEqual([]);
  });
});

describe('formatMeetingDuration', () => {
  it('uses m:ss under an hour and h:mm:ss above', () => {
    expect(formatMeetingDuration(0)).toBe('0:00');
    expect(formatMeetingDuration(65_400)).toBe('1:05');
    expect(formatMeetingDuration(3_725_000)).toBe('1:02:05');
    expect(formatMeetingDuration(-5)).toBe('0:00');
  });
});
