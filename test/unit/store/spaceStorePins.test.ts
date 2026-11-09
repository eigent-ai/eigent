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
  getCurrentPinnedSpaceIds,
  getPinnedSpaceIds,
  MAX_PINNED_SPACES,
  SPACE_SCHEMA_VERSION,
  useSpaceStore,
  type Space,
} from '@/store/spaceStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authStoreMock = vi.hoisted(() => ({
  state: { user_id: 2 as number | null, email: 'user@example.com' },
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => authStoreMock.state,
}));

vi.mock('@/service/workspaceApi', () => ({
  createScratchWorkspaceForSpace: vi.fn(),
  fetchWorkspaceCurrent: vi.fn(),
  reconcileWorkspaceBindings: vi.fn().mockResolvedValue(undefined),
  unbindWorkspaceFromBrain: vi.fn().mockResolvedValue(undefined),
}));

const makeSpace = (id: string, userId = '2'): Space => ({
  id,
  name: `Space ${id}`,
  userId,
  sourceType: 'blank',
  rootPath: null,
  rootFingerprint: null,
  status: 'active',
  schemaVersion: SPACE_SCHEMA_VERSION,
  createdAt: 1,
  updatedAt: 1,
});

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];

const pinned = () => useSpaceStore.getState().pinnedSpaceIdsByUser['2'];

describe('spaceStore pinned Spaces', () => {
  beforeEach(() => {
    authStoreMock.state = { user_id: 2, email: 'user@example.com' };
    useSpaceStore.setState({
      activeSpaceId: 'a',
      spaces: Object.fromEntries(ids.map((id) => [id, makeSpace(id)])),
      pinnedSpaceIdsByUser: {},
    });
  });

  it('pins in order and reports a repeated pin', () => {
    const { pinSpace } = useSpaceStore.getState();

    expect(pinSpace('b')).toBe('pinned');
    expect(pinSpace('a')).toBe('pinned');
    expect(pinSpace('b')).toBe('already-pinned');
    expect(pinSpace('missing')).toBe('missing');
    expect(pinned()).toEqual(['b', 'a']);
    expect(getCurrentPinnedSpaceIds()).toEqual(['b', 'a']);
  });

  it('allows ten pins and refuses the eleventh', () => {
    const { pinSpace } = useSpaceStore.getState();
    expect(MAX_PINNED_SPACES).toBe(10);
    for (const id of ids.slice(0, MAX_PINNED_SPACES)) {
      expect(pinSpace(id)).toBe('pinned');
    }

    expect(pinSpace('k')).toBe('full');
    expect(pinned()).toEqual(ids.slice(0, MAX_PINNED_SPACES));
  });

  it('unpins, then frees a slot for another Space', () => {
    const { pinSpace, unpinSpace } = useSpaceStore.getState();
    for (const id of ids.slice(0, MAX_PINNED_SPACES)) pinSpace(id);

    unpinSpace('c');
    expect(pinSpace('k')).toBe('pinned');
    expect(pinned()).toEqual([
      ...ids.slice(0, MAX_PINNED_SPACES).filter((id) => id !== 'c'),
      'k',
    ]);
  });

  it('moves a pin and clamps the target', () => {
    const { setPinnedSpaces, moveSpacePin } = useSpaceStore.getState();
    setPinnedSpaces(['a', 'b', 'c']);

    moveSpacePin('c', 0);
    expect(pinned()).toEqual(['c', 'a', 'b']);
    moveSpacePin('c', 10);
    expect(pinned()).toEqual(['a', 'b', 'c']);
    moveSpacePin('f', 0);
    expect(pinned()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the chooser list unique, known and at most ten', () => {
    useSpaceStore.getState().setPinnedSpaces(['a', 'a', 'gone', ...ids]);

    expect(pinned()).toEqual(ids.slice(0, MAX_PINNED_SPACES));
  });

  it('drops a deleted or archived Space from the pins', () => {
    const { setPinnedSpaces, deleteSpace, updateSpace, upsertSpaces } =
      useSpaceStore.getState();
    setPinnedSpaces(['a', 'b', 'c']);

    deleteSpace('a');
    expect(pinned()).toEqual(['b', 'c']);
    updateSpace('b', { status: 'archived' });
    expect(pinned()).toEqual(['c']);
    upsertSpaces([{ ...makeSpace('c'), status: 'archived' }]);
    expect(pinned()).toEqual([]);
  });

  it('hides a pin whose Space is missing without forgetting it', () => {
    useSpaceStore.getState().setPinnedSpaces(['a', 'b']);
    const { b: _removed, ...rest } = useSpaceStore.getState().spaces;
    useSpaceStore.setState({ spaces: rest });

    expect(getPinnedSpaceIds(useSpaceStore.getState(), '2')).toEqual(['a']);
    expect(pinned()).toEqual(['a', 'b']);
  });

  it("keeps a missing Space's pin through pinning, moving and choosing", () => {
    useSpaceStore.getState().setPinnedSpaces(['a', 'b', 'c']);
    const allSpaces = useSpaceStore.getState().spaces;
    const { b: _removed, ...rest } = allSpaces;
    useSpaceStore.setState({ spaces: rest });

    useSpaceStore.getState().pinSpace('d');
    expect(pinned()).toEqual(['a', 'b', 'c', 'd']);

    useSpaceStore.getState().moveSpacePin('d', 0);
    expect(pinned()).toEqual(['d', 'b', 'a', 'c']);

    useSpaceStore.getState().setPinnedSpaces(['c']);
    expect(pinned()).toEqual(['c', 'b']);

    useSpaceStore.setState({ spaces: allSpaces });
    expect(getCurrentPinnedSpaceIds()).toEqual(['c', 'b']);
  });

  it('keeps each account its own pins', () => {
    useSpaceStore.getState().pinSpace('a');
    authStoreMock.state = { user_id: 7, email: 'other@example.com' };
    useSpaceStore.getState().pinSpace('b');

    expect(useSpaceStore.getState().pinnedSpaceIdsByUser).toEqual({
      '2': ['a'],
      '7': ['b'],
    });
    expect(getCurrentPinnedSpaceIds()).toEqual(['b']);
    authStoreMock.state = { user_id: null, email: '' };
    expect(getCurrentPinnedSpaceIds()).toEqual([]);
  });

  it('persists pins with the rest of the Space store', () => {
    useSpaceStore.getState().pinSpace('a');
    const persisted = useSpaceStore.persist
      .getOptions()
      .partialize?.(useSpaceStore.getState()) as {
      pinnedSpaceIdsByUser?: Record<string, string[]>;
    };

    expect(persisted.pinnedSpaceIdsByUser).toEqual({ '2': ['a'] });
  });
});
