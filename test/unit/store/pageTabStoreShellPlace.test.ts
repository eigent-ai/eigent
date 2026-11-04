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
  isHomePlaceTab,
  usePageTabStore,
  type PageTabState,
} from '@/store/pageTabStore';
import { beforeEach, describe, expect, it } from 'vitest';

describe('pageTabStore shell place', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      activeWorkspaceTab: 'workforce',
      shellPlace: 'home',
      homeFoldedSpaceIds: [],
      unviewedTabs: new Set(),
      filesUnviewedForProjects: new Set(),
    });
  });

  it.each(['workforce', 'project', 'new-project'] as const)(
    'keeps Home when %s opens',
    (tab) => {
      usePageTabStore.getState().setActiveWorkspaceTab(tab);
      expect(usePageTabStore.getState().shellPlace).toBe('home');
      expect(isHomePlaceTab(tab)).toBe(true);
    }
  );

  it.each([
    'files',
    'triggers',
    'dispatch',
    'runs',
    'space-workspace',
  ] as const)('moves to the Space view when %s opens', (tab) => {
    usePageTabStore.getState().setActiveWorkspaceTab(tab);
    expect(usePageTabStore.getState()).toMatchObject({
      activeWorkspaceTab: tab,
      shellPlace: 'space',
    });
    expect(isHomePlaceTab(tab)).toBe(false);
  });

  it('moves to the Space view when the add-automation dialog opens', () => {
    usePageTabStore.getState().requestOpenTriggerAddDialog();
    expect(usePageTabStore.getState()).toMatchObject({
      activeWorkspaceTab: 'triggers',
      shellPlace: 'space',
    });
  });

  it('never leaves the Space view for a chat tab on its own', () => {
    usePageTabStore.setState({ shellPlace: 'space' });
    usePageTabStore.getState().setActiveWorkspaceTab('project');
    expect(usePageTabStore.getState().shellPlace).toBe('space');
  });

  it('folds and unfolds a Space once', () => {
    const { setHomeSpaceFolded } = usePageTabStore.getState();
    setHomeSpaceFolded('space-a', true);
    setHomeSpaceFolded('space-a', true);
    setHomeSpaceFolded('space-b', true);
    expect(usePageTabStore.getState().homeFoldedSpaceIds).toEqual([
      'space-a',
      'space-b',
    ]);
    setHomeSpaceFolded('space-a', false);
    expect(usePageTabStore.getState().homeFoldedSpaceIds).toEqual(['space-b']);
  });

  it('persists the place and folds, and restores only valid values', () => {
    const options = usePageTabStore.persist.getOptions();
    usePageTabStore.getState().setHomeSpaceFolded('space-a', true);
    expect(options.partialize!(usePageTabStore.getState())).toMatchObject({
      shellPlace: 'home',
      homeFoldedSpaceIds: ['space-a'],
    });

    const current = usePageTabStore.getInitialState();
    const merge = options.merge!;
    expect(
      merge({ shellPlace: 'home', homeFoldedSpaceIds: ['x', 3] }, current)
    ).toMatchObject({ shellPlace: 'home', homeFoldedSpaceIds: ['x'] });
    expect(
      merge(
        { shellPlace: 'elsewhere' } as unknown as Partial<PageTabState>,
        current
      )
    ).toMatchObject({ shellPlace: 'space', homeFoldedSpaceIds: [] });
    expect(merge(undefined, current).shellPlace).toBe('space');
  });

  it('opens the Workspace page on a chosen tab, in the Space view', () => {
    usePageTabStore.setState({ shellPlace: 'home' });

    usePageTabStore.getState().openSpaceWorkspaceTab('workspace-profile');

    expect(usePageTabStore.getState()).toMatchObject({
      activeWorkspaceTab: 'space-workspace',
      spaceWorkspaceTab: 'workspace-profile',
      shellPlace: 'space',
    });
  });

  it('persists the Spaces sort and restores only a known value', () => {
    const options = usePageTabStore.persist.getOptions();
    usePageTabStore.getState().setHomeSpaceSort('created');
    expect(options.partialize!(usePageTabStore.getState())).toMatchObject({
      homeSpaceSort: 'created',
    });

    const current = usePageTabStore.getInitialState();
    const merge = options.merge!;
    expect(merge({ homeSpaceSort: 'created' }, current).homeSpaceSort).toBe(
      'created'
    );
    expect(
      merge(
        { homeSpaceSort: 'name' } as unknown as Partial<PageTabState>,
        current
      ).homeSpaceSort
    ).toBe('updated');
    expect(merge(undefined, current).homeSpaceSort).toBe('updated');
  });

  it('persists the sidebar grouping and restores only a known value', () => {
    const options = usePageTabStore.persist.getOptions();
    usePageTabStore.getState().setHomeSidebarGrouping('list');
    expect(options.partialize!(usePageTabStore.getState())).toMatchObject({
      homeSidebarGrouping: 'list',
    });

    const current = usePageTabStore.getInitialState();
    const merge = options.merge!;
    expect(
      merge({ homeSidebarGrouping: 'list' }, current).homeSidebarGrouping
    ).toBe('list');
    expect(
      merge(
        { homeSidebarGrouping: 'folders' } as unknown as Partial<PageTabState>,
        current
      ).homeSidebarGrouping
    ).toBe('spaces');
  });
});
