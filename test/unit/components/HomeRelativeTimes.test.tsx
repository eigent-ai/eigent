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
  HomeHubProvider,
  type HomeHubContextValue,
} from '@/components/Home/context';
import { useSpaceDetailData } from '@/components/Home/hooks/useSpaceDetailData';
import {
  compareHubByTimestamp,
  formatHubDate,
  formatHubRelativeAgo,
  timestampFromHubValue,
} from '@/components/Home/utils';
import {
  toLocalSpace,
  type ServerProject,
  type ServerSpace,
} from '@/service/spaceApi';
import { projectMetaFromServer, useSpaceStore } from '@/store/spaceStore';
import type { ProjectGroup } from '@/types/history';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// The API sends UTC datetimes without a timezone designator. In a timezone
// ahead of UTC, reading them as local time made items created five minutes
// ago look eight hours old.
const originalTimezone = process.env.TZ;
const NOW = '2026-10-08T04:05:30.000Z';
const FIVE_MINUTES_AGO_FROM_API = '2026-10-08T04:00:00.123456';
const FOUR_AM_UTC = Date.UTC(2026, 9, 8, 4, 0, 0);

const t = (key: string, options?: Record<string, unknown>) =>
  options?.count === undefined ? key : `${key}:${String(options.count)}`;

const serverSpace = (overrides: Partial<ServerSpace> = {}): ServerSpace => ({
  id: 'space-1',
  user_id: '1',
  name: 'Research',
  source_type: 'blank',
  status: 'active',
  schema_version: 1,
  created_at: FIVE_MINUTES_AGO_FROM_API,
  updated_at: FIVE_MINUTES_AGO_FROM_API,
  ...overrides,
});

const serverProject = (
  overrides: Partial<ServerProject> = {}
): ServerProject => ({
  id: 'project-1',
  user_id: '1',
  space_id: 'space-1',
  name: 'Weekly report',
  status: 'active',
  created_at: FIVE_MINUTES_AGO_FROM_API,
  updated_at: FIVE_MINUTES_AGO_FROM_API,
  ...overrides,
});

describe('Home relative times for API timestamps', () => {
  beforeAll(() => {
    process.env.TZ = 'Asia/Singapore';
  });

  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs in a timezone ahead of UTC', () => {
    expect(new Date(2026, 9, 8).getTimezoneOffset()).toBe(-480);
  });

  it('shows a Task created five minutes ago as 5 minutes ago', () => {
    expect(formatHubRelativeAgo(FIVE_MINUTES_AGO_FROM_API, t)).toBe(
      'layout.home-relative-minutes-ago:5'
    );
  });

  it.each([
    ['a UTC string', '2026-10-08T04:00:00.000Z'],
    ['an offset string', '2026-10-08T12:00:00+08:00'],
    ['epoch milliseconds', FOUR_AM_UTC],
  ])('keeps the meaning of %s', (_label, value) => {
    expect(formatHubRelativeAgo(value, t)).toBe(
      'layout.home-relative-minutes-ago:5'
    );
  });

  it('formats the calendar day in the viewer timezone', () => {
    // 20:00 UTC is 04:00 the next day in Singapore.
    expect(formatHubDate('2026-10-08T20:00:00', 'en-US')).toBe('Oct 09, 2026');
  });

  it('sorts API strings against UTC strings by their real instant', () => {
    const fromApi = '2026-10-08T04:00:00';
    const earlierUtc = '2026-10-08T01:00:00.000Z';

    expect(timestampFromHubValue(fromApi)).toBe(FOUR_AM_UTC);
    expect(compareHubByTimestamp(fromApi, earlierUtc, 'desc')).toBeLessThan(0);
    expect(compareHubByTimestamp(fromApi, earlierUtc, 'asc')).toBeGreaterThan(
      0
    );
  });

  it('shows a Space created five minutes ago as 5 minutes ago', () => {
    const space = toLocalSpace(serverSpace());

    expect(space.createdAt).toBe(FOUR_AM_UTC + 123);
    expect(space.updatedAt).toBe(FOUR_AM_UTC + 123);
    expect(formatHubRelativeAgo(space.createdAt, t)).toBe(
      'layout.home-relative-minutes-ago:5'
    );
  });

  it('shows a Session updated five minutes ago as 5 minutes ago', () => {
    const meta = projectMetaFromServer(serverProject());

    expect(meta.createdAt).toBe(FOUR_AM_UTC + 123);
    expect(meta.updatedAt).toBe(FOUR_AM_UTC + 123);
    // Sessions without Task history fall back to their metadata timestamp.
    expect(
      formatHubRelativeAgo(new Date(meta.updatedAt).toISOString(), t)
    ).toBe('layout.home-relative-minutes-ago:5');
  });

  it('orders Space detail Sessions by their real last update', () => {
    const spaceId = 'space-1';
    // Updated at 04:00 UTC according to Task history from the API.
    const sessionWithHistory: ProjectGroup = {
      project_id: 'project-with-history',
      space_id: spaceId,
      project_name: 'Weekly report',
      total_tokens: 0,
      task_count: 1,
      total_triggers: 0,
      latest_task_date: '2026-10-08T04:00:00.123456',
      last_prompt: '',
      tasks: [],
      total_completed_tasks: 1,
      total_ongoing_tasks: 0,
      average_tokens_per_task: 0,
    };
    // Updated at 02:00 UTC and known only from local Session metadata.
    useSpaceStore.setState({
      projectsBySpaceId: {
        [spaceId]: {
          'project-without-history': {
            id: 'project-without-history',
            spaceId,
            name: 'Draft notes',
            status: 'active',
            createdAt: Date.UTC(2026, 9, 8, 2, 0, 0),
            updatedAt: Date.UTC(2026, 9, 8, 2, 0, 0),
          },
        },
      },
      projectsSyncedAt: { [spaceId]: Date.now() },
    });
    const hub = {
      projects: [sessionWithHistory],
      projectsLoading: false,
      triggers: [],
      triggersLoading: false,
    } as unknown as HomeHubContextValue;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HomeHubProvider value={hub}>{children}</HomeHubProvider>
    );

    const { result } = renderHook(() => useSpaceDetailData(spaceId), {
      wrapper,
    });

    expect(
      result.current.projects.map((project) => project.project_id)
    ).toEqual(['project-with-history', 'project-without-history']);
  });
});
