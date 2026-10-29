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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const SPACE_OVERVIEW_BOXES = [
  'location',
  'files',
  'sessions',
  'automations',
  'dispatch',
  'versionHistory',
] as const;

export type SpaceOverviewBoxId = (typeof SPACE_OVERVIEW_BOXES)[number];

export interface SpaceOverviewLayout {
  order: SpaceOverviewBoxId[];
  hiddenBoxes: SpaceOverviewBoxId[];
}

const isBoxId = (value: unknown): value is SpaceOverviewBoxId =>
  SPACE_OVERVIEW_BOXES.includes(value as SpaceOverviewBoxId);

/**
 * Every box exactly once, in the saved order. Saved ids that no longer exist
 * are dropped, and boxes added later join at the end.
 */
export function normalizeSpaceOverviewOrder(
  order: readonly unknown[]
): SpaceOverviewBoxId[] {
  const known = [...new Set(order.filter(isBoxId))];
  return [
    ...known,
    ...SPACE_OVERVIEW_BOXES.filter((id) => !known.includes(id)),
  ];
}

const normalizeLayout = (
  layout: Partial<SpaceOverviewLayout> | undefined
): SpaceOverviewLayout => ({
  order: normalizeSpaceOverviewOrder(layout?.order ?? []),
  hiddenBoxes: [...new Set((layout?.hiddenBoxes ?? []).filter(isBoxId))],
});

/**
 * A Space never edited shows Folder, Files, Sessions, Automations and
 * Dispatch; Version history is offered in edit mode.
 */
export const DEFAULT_SPACE_OVERVIEW_LAYOUT: SpaceOverviewLayout =
  normalizeLayout({ hiddenBoxes: ['versionHistory'] });

// Which boxes the Workspace Space panel shows for each Space, and in what
// order; a per-device preference saved from the panel's edit mode.
type SpaceOverviewState = {
  layouts: Record<string, SpaceOverviewLayout>;
  saveLayout: (spaceId: string, layout: SpaceOverviewLayout) => void;
};

export const useSpaceOverviewStore = create<SpaceOverviewState>()(
  persist(
    (set) => ({
      layouts: {},
      saveLayout: (spaceId, layout) =>
        set((state) => ({
          layouts: { ...state.layouts, [spaceId]: normalizeLayout(layout) },
        })),
    }),
    {
      // v2 keys the layout by Space; the earlier single layout is dropped.
      name: 'eigent-space-overview-v2',
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SpaceOverviewState>;
        const layouts: Record<string, SpaceOverviewLayout> = {};
        for (const [spaceId, layout] of Object.entries(saved.layouts ?? {}))
          layouts[spaceId] = normalizeLayout(layout);
        return { ...current, layouts };
      },
    }
  )
);

/** The saved layout of a Space, or the default for one never edited. */
export const selectSpaceOverviewLayout =
  (spaceId: string | null | undefined) =>
  (state: SpaceOverviewState): SpaceOverviewLayout =>
    (spaceId && state.layouts[spaceId]) || DEFAULT_SPACE_OVERVIEW_LAYOUT;
