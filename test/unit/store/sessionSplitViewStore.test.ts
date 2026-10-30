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

import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SESSION_PANES,
  selectSessionPanes,
  useSessionSplitViewStore,
} from '../../../src/store/sessionSplitViewStore';

const panes = (spaceId: string) =>
  selectSessionPanes(spaceId)(useSessionSplitViewStore.getState());

describe('session split view store', () => {
  beforeEach(() => {
    useSessionSplitViewStore.setState({ panesBySpaceId: {} });
  });

  it('starts a split from the open Session and adds panes to its right', () => {
    const store = useSessionSplitViewStore.getState();
    expect(store.openPane('space', 'a', 'b')).toBe(true);
    expect(panes('space')).toEqual(['a', 'b']);
    expect(store.openPane('space', 'b', 'c')).toBe(true);
    expect(panes('space')).toEqual(['a', 'b', 'c']);
  });

  it(`refuses a pane beyond ${MAX_SESSION_PANES} and ignores one already shown`, () => {
    const store = useSessionSplitViewStore.getState();
    store.openPane('space', 'a', 'b');
    store.openPane('space', 'a', 'c');
    expect(store.openPane('space', 'a', 'd')).toBe(false);
    expect(store.openPane('space', 'c', 'b')).toBe(true);
    expect(panes('space')).toEqual(['a', 'b', 'c']);
  });

  it('replaces a saved split that does not show the open Session', () => {
    const store = useSessionSplitViewStore.getState();
    store.openPane('space', 'a', 'b');
    store.openPane('space', 'x', 'y');
    expect(panes('space')).toEqual(['x', 'y']);
  });

  it('replaces the focused pane when another Session is selected', () => {
    const store = useSessionSplitViewStore.getState();
    store.openPane('space', 'a', 'b');
    store.replacePane('space', 'b', 'c');
    expect(panes('space')).toEqual(['a', 'c']);
    // A Session already shown keeps its pane; nothing is duplicated.
    store.replacePane('space', 'c', 'a');
    expect(panes('space')).toEqual(['a', 'c']);
  });

  it('ends the split when one pane is left and keeps the left one', () => {
    const store = useSessionSplitViewStore.getState();
    store.openPane('space', 'a', 'b');
    store.closePane('space', 'b');
    expect(panes('space')).toEqual([]);
    expect(useSessionSplitViewStore.getState().panesBySpaceId).toEqual({});
  });

  it('forgets a deleted Session in every Space', () => {
    const store = useSessionSplitViewStore.getState();
    store.openPane('one', 'a', 'b');
    store.openPane('one', 'a', 'c');
    store.openPane('two', 'd', 'b');
    store.forgetSession('b');
    expect(panes('one')).toEqual(['a', 'c']);
    expect(panes('two')).toEqual([]);
  });

  it('keeps splits per Space across restarts and drops invalid saved panes', async () => {
    localStorage.setItem(
      'eigent-session-split-view-v1',
      JSON.stringify({
        state: {
          panesBySpaceId: {
            kept: ['a', 'b', 'a', 7, 'c', 'd'],
            single: ['a'],
          },
        },
        version: 0,
      })
    );
    await useSessionSplitViewStore.persist.rehydrate();
    expect(panes('kept')).toEqual(['a', 'b', 'c']);
    expect(panes('single')).toEqual([]);
  });
});
