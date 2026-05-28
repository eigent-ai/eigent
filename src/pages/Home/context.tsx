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

import { ProjectGroup as ProjectGroupType } from '@/types/history';
import { createContext, useContext } from 'react';

export type HomeViewMode = 'grid' | 'list';

export type HomeHubContextValue = {
  viewMode: HomeViewMode;
  setViewMode: (mode: HomeViewMode) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  projects: ProjectGroupType[];
  projectsLoading: boolean;
  onTaskDelete: (historyId: string, callback?: () => void) => void;
  onTaskShare: (taskId: string) => void;
  onProjectDelete: (projectId: string) => void;
  onProjectRename: (projectId: string, newName: string) => void;
  activeTaskId?: string;
  onOngoingTaskPause?: (taskId: string) => void;
  onOngoingTaskResume?: (taskId: string) => void;
};

const HomeHubContext = createContext<HomeHubContextValue | null>(null);

export function HomeHubProvider({
  value,
  children,
}: {
  value: HomeHubContextValue;
  children: React.ReactNode;
}) {
  return (
    <HomeHubContext.Provider value={value}>{children}</HomeHubContext.Provider>
  );
}

export function useHomeHub() {
  const context = useContext(HomeHubContext);
  if (!context) {
    throw new Error('useHomeHub must be used within HomeHubProvider');
  }
  return context;
}
