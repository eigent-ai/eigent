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

import { useHomeHubNavigation } from '@/components/Home/hooks/useHomeHubNavigation';
import type { Trigger } from '@/types';
import type { ProjectGroup } from '@/types/history';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createProjectMock,
  getProjectByIdMock,
  navigateMock,
  pageTabState,
  projectStore,
  spaceState,
} = vi.hoisted(() => {
  const createProjectMock = vi.fn();
  const getProjectByIdMock = vi.fn();

  return {
    createProjectMock,
    getProjectByIdMock,
    navigateMock: vi.fn(),
    pageTabState: {
      requestSelectTrigger: vi.fn(),
      requestWorkspaceChatFocus: vi.fn(),
      setActiveWorkspaceTab: vi.fn(),
    },
    projectStore: {
      createProject: createProjectMock,
      getProjectById: getProjectByIdMock,
      setActiveProject: vi.fn(),
      setHistoryId: vi.fn(),
    },
    spaceState: {
      setActiveSpace: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null }),
  useNavigate: () => navigateMock,
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: () => projectStore,
}));

vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (selector: (state: typeof pageTabState) => unknown) =>
    selector(pageTabState),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: typeof spaceState) => unknown) =>
    selector(spaceState),
}));

describe('useHomeHubNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProjectByIdMock.mockReturnValue(undefined);
  });

  it('qualifies a nameless Work Session fallback with its Project ID', async () => {
    const { result } = renderHook(() => useHomeHubNavigation());

    await act(async () => {
      await result.current.openWorkSession({
        project_id: 'project-42',
        project_name: '',
        tasks: [],
      } as ProjectGroup);
    });

    expect(createProjectMock).toHaveBeenCalledWith(
      'Session project-42',
      'Session with automations',
      'project-42'
    );
  });

  it('qualifies a nameless Automation Session fallback with its Project ID', async () => {
    const { result } = renderHook(() => useHomeHubNavigation());

    await act(async () => {
      await result.current.openAutomation({
        id: 7,
        name: '',
        project_id: 'automation-project-9',
      } as Trigger);
    });

    expect(createProjectMock).toHaveBeenCalledWith(
      'Session automation-project-9',
      'Session with automations',
      'automation-project-9'
    );
  });
});
