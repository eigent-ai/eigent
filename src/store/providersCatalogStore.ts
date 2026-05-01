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

import { INIT_PROVODERS } from '@/lib/llm';
import {
  buildProvidersCatalogSnapshot,
  createInitialCatalogForm,
  type ProvidersCatalogFormRow,
  type ProvidersCatalogModelType,
} from '@/lib/mergeProvidersCatalog';
import type { Provider } from '@/types';
import { create } from 'zustand';

export const CATALOG_ITEMS: Provider[] = INIT_PROVODERS.filter(
  (p) => p.id !== 'local'
);

const initialForm = (): ProvidersCatalogFormRow[] =>
  createInitialCatalogForm(CATALOG_ITEMS);

export interface ProvidersCatalogState {
  form: ProvidersCatalogFormRow[];
  localEndpoints: Record<string, string>;
  localTypes: Record<string, string>;
  localProviderIds: Record<string, number | undefined>;
  cloudPrefer: boolean;
  localPrefer: boolean;
  localPlatform: string;
  hasPreferredProvider: boolean;
  hydrated: boolean;
  lastFetchedAt: number | null;

  applyFromApiResponse: (
    res: unknown,
    modelType: ProvidersCatalogModelType
  ) => void;
  reset: () => void;
  setForm: (
    updater: (prev: ProvidersCatalogFormRow[]) => ProvidersCatalogFormRow[]
  ) => void;
  setCloudPrefer: (v: boolean) => void;
  setLocalPrefer: (v: boolean) => void;
  setLocalPlatform: (p: string) => void;
}

const baseState = () => ({
  form: initialForm(),
  localEndpoints: {} as Record<string, string>,
  localTypes: {} as Record<string, string>,
  localProviderIds: {} as Record<string, number | undefined>,
  cloudPrefer: false,
  localPrefer: false,
  localPlatform: '',
  hasPreferredProvider: false,
  hydrated: false,
  lastFetchedAt: null as number | null,
});

export const useProvidersCatalogStore = create<ProvidersCatalogState>()(
  (set) => ({
    ...baseState(),

    applyFromApiResponse: (res, modelType) => {
      const snap = buildProvidersCatalogSnapshot(CATALOG_ITEMS, res, modelType);
      set({
        ...snap,
        hydrated: true,
        lastFetchedAt: Date.now(),
      });
    },

    reset: () => set(baseState()),

    setForm: (updater) => set((s) => ({ form: updater(s.form) })),

    setCloudPrefer: (cloudPrefer) => set({ cloudPrefer }),

    setLocalPrefer: (localPrefer) => set({ localPrefer }),

    setLocalPlatform: (localPlatform) => set({ localPlatform }),
  })
);

export function getProvidersCatalogItems(): Provider[] {
  return CATALOG_ITEMS;
}
