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
  getVisibleProjectMetasForSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { spaceLastActivity } from './homeSidebarModel';

/** Last activity per Space and per Session, as it was when Home opened. */
export interface HomeActivitySnapshot {
  spaces: Record<string, number>;
  sessions: Record<string, number>;
}

interface HomeVisitState {
  /** Bumped each time Home becomes the selected place. */
  visit: number;
  activity: HomeActivitySnapshot;
  startVisit: () => void;
}

function captureActivity(): HomeActivitySnapshot {
  const { spaces, projectsBySpaceId } = useSpaceStore.getState();
  const snapshot: HomeActivitySnapshot = { spaces: {}, sessions: {} };
  for (const space of Object.values(spaces)) {
    const sessions = getVisibleProjectMetasForSpace(
      projectsBySpaceId,
      space.id
    );
    snapshot.spaces[space.id] = spaceLastActivity(space, sessions);
    for (const session of sessions) {
      snapshot.sessions[session.id] = session.updatedAt;
    }
  }
  return snapshot;
}

/**
 * Home's sidebar sorts Spaces and Sessions once per visit, so rows never move
 * under the pointer while Home is open. Moving between Home's pages (New
 * session, a Session, All Spaces, a Workspace page) is the same visit.
 */
export const useHomeVisitStore = create<HomeVisitState>((set) => ({
  visit: 0,
  activity: { spaces: {}, sessions: {} },
  startVisit: () =>
    set((state) => ({ visit: state.visit + 1, activity: captureActivity() })),
}));

/** Start a new Home visit whenever Home becomes the selected place. */
export function useHomeVisitTracking(homeSelected: boolean) {
  const wasSelected = useRef(false);
  useEffect(() => {
    if (homeSelected && !wasSelected.current) {
      useHomeVisitStore.getState().startVisit();
    }
    wasSelected.current = homeSelected;
  }, [homeSelected]);
}
