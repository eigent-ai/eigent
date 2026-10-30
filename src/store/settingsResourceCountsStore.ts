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

export type SettingsResourceCountKey = 'browser-connections' | 'cookies';

type SettingsResourceCountsState = {
  counts: Record<SettingsResourceCountKey, number | null>;
  setCount: (key: SettingsResourceCountKey, count: number) => void;
};

export const useSettingsResourceCountsStore =
  create<SettingsResourceCountsState>((set) => ({
    counts: {
      'browser-connections': null,
      cookies: null,
    },
    setCount: (key, count) =>
      set((state) => {
        const nextCount = Math.max(0, count);
        if (state.counts[key] === nextCount) return state;
        return {
          counts: {
            ...state.counts,
            [key]: nextCount,
          },
        };
      }),
  }));
