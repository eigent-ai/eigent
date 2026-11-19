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
  SHELL_HISTORY_LIMIT,
  shellPlaceKey,
  useShellHistoryStore,
  type ShellPlaceEntry,
} from '@/store/shellHistoryStore';
import { beforeEach, describe, expect, it } from 'vitest';

const place = (
  workspaceTab: string,
  overrides: Partial<ShellPlaceEntry> = {}
): ShellPlaceEntry => ({
  path: '/',
  routerState: null,
  shellPlace: 'space',
  spaceId: 'space-a',
  workspaceTab,
  spaceWorkspaceTab: 'projects',
  projectId: null,
  ...overrides,
});

const history = () => useShellHistoryStore.getState();

describe('shell history', () => {
  beforeEach(() => useShellHistoryStore.setState({ entries: [], index: -1 }));

  it('records a place once, however often it is seen', () => {
    history().record(place('files'));
    history().record(place('files'));
    expect(history().entries).toHaveLength(1);
  });

  it('steps back and forward, and stops at the ends', () => {
    history().record(place('new-project'));
    history().record(place('files'));

    expect(history().step(-1)?.workspaceTab).toBe('new-project');
    expect(history().step(-1)).toBeNull();
    expect(history().step(1)?.workspaceTab).toBe('files');
    expect(history().step(1)).toBeNull();
  });

  it('drops Forward when a new place follows Back', () => {
    history().record(place('new-project'));
    history().record(place('files'));
    history().record(place('triggers'));
    history().step(-1);
    history().step(-1);

    history().record(place('dispatch'));

    expect(history().entries.map((entry) => entry.workspaceTab)).toEqual([
      'new-project',
      'dispatch',
    ]);
    expect(history().step(1)).toBeNull();
  });

  it('keeps only the most recent places', () => {
    for (let index = 0; index < SHELL_HISTORY_LIMIT + 5; index += 1) {
      history().record(place('project', { projectId: `session-${index}` }));
    }
    expect(history().entries).toHaveLength(SHELL_HISTORY_LIMIT);
    expect(history().index).toBe(SHELL_HISTORY_LIMIT - 1);
    expect(history().entries[0].projectId).toBe('session-5');
  });

  it('corrects the current place without adding one', () => {
    history().record(place('new-project'));
    history().record(place('project', { projectId: 'gone' }));
    history().step(-1);
    history().replace(place('files'));

    expect(history().entries.map((entry) => entry.workspaceTab)).toEqual([
      'files',
      'project',
    ]);
    expect(history().index).toBe(0);
  });

  it('tells places apart by page, Space, tab and Session', () => {
    const key = shellPlaceKey(place('project', { projectId: 'one' }));
    expect(shellPlaceKey(place('project', { projectId: 'two' }))).not.toBe(key);
    expect(
      shellPlaceKey(place('project', { projectId: 'one', shellPlace: 'home' }))
    ).not.toBe(key);
    expect(
      shellPlaceKey(place('project', { path: '/settings?tab=models' }))
    ).toBe('/settings?tab=models');
    // The Workspace page's tab only matters on that page.
    expect(shellPlaceKey(place('files', { spaceWorkspaceTab: 'memory' }))).toBe(
      shellPlaceKey(place('files'))
    );
  });
});
