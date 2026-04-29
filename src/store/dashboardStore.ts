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

import type { WorkflowAgentType } from '@/components/WorkFlow/agents';
import {
  DEFAULT_COLUMN_VISIBILITY,
  type TaskStatusBucket,
} from '@/types/dashboard';
import { create } from 'zustand';

interface DashboardFilters {
  search: string;
  projectId: string | null;
  agentType: WorkflowAgentType | null;
  bucket: TaskStatusBucket | null;
}

interface DashboardStore {
  viewMode: 'board' | 'list';
  filters: DashboardFilters;
  columnVisibility: Record<TaskStatusBucket, boolean>;

  setViewMode: (mode: 'board' | 'list') => void;
  setFilter: (patch: Partial<DashboardFilters>) => void;
  resetFilters: () => void;
  setColumnBucketVisible: (bucket: TaskStatusBucket, visible: boolean) => void;
  resetBoardColumns: () => void;
}

const DEFAULT_FILTERS: DashboardFilters = {
  search: '',
  projectId: null,
  agentType: null,
  bucket: null,
};

export const useDashboardStore = create<DashboardStore>((set) => ({
  viewMode: 'board',
  filters: { ...DEFAULT_FILTERS },
  columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY },

  setViewMode: (mode) => set({ viewMode: mode }),
  setFilter: (patch) =>
    set((state) => ({ filters: { ...state.filters, ...patch } })),
  resetFilters: () => set({ filters: { ...DEFAULT_FILTERS } }),
  setColumnBucketVisible: (bucket, visible) =>
    set((state) => ({
      columnVisibility: { ...state.columnVisibility, [bucket]: visible },
    })),
  resetBoardColumns: () =>
    set({ columnVisibility: { ...DEFAULT_COLUMN_VISIBILITY } }),
}));
