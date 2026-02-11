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

/**
 * Unit tests for load vs replay fix (Issue #1227)
 *
 * - loadProjectFromHistory: loads final state (no animation), awaits completion, then navigates
 * - replayProject: replays with animation, navigates immediately (fire-and-forget)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProjectFromHistory, replayProject } from '../../../src/lib/replay';

describe('replay lib', () => {
  const mockNavigate = vi.fn();
  let mockProjectStore: {
    loadProjectFromHistory: ReturnType<typeof vi.fn>;
    replayProject: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore = {
      loadProjectFromHistory: vi.fn().mockResolvedValue('loaded-project-id'),
      replayProject: vi.fn(),
    };
  });

  describe('loadProjectFromHistory', () => {
    it('calls projectStore.loadProjectFromHistory with taskIds and navigates after', async () => {
      await loadProjectFromHistory(
        mockProjectStore as any,
        mockNavigate as any,
        'project-1',
        'Test question',
        'history-123',
        ['task-1', 'task-2'],
        'My Project'
      );

      expect(mockProjectStore.loadProjectFromHistory).toHaveBeenCalledWith(
        ['task-1', 'task-2'],
        'Test question',
        'project-1',
        'history-123',
        'My Project'
      );
      expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/' });
    });

    it('defaults taskIdsList to [projectId] when not provided', async () => {
      await loadProjectFromHistory(
        mockProjectStore as any,
        mockNavigate as any,
        'project-1',
        'Test question',
        'history-123'
      );

      expect(mockProjectStore.loadProjectFromHistory).toHaveBeenCalledWith(
        ['project-1'],
        'Test question',
        'project-1',
        'history-123',
        undefined
      );
    });

    it('awaits loadProjectFromHistory before navigating', async () => {
      let resolveLoad: () => void;
      mockProjectStore.loadProjectFromHistory.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveLoad = r;
          })
      );

      const loadPromise = loadProjectFromHistory(
        mockProjectStore as any,
        mockNavigate as any,
        'project-1',
        'Q',
        'h1'
      );

      expect(mockNavigate).not.toHaveBeenCalled();
      resolveLoad!();
      await loadPromise;
      expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/' });
    });
  });

  describe('replayProject', () => {
    it('calls projectStore.replayProject and navigates immediately', async () => {
      await replayProject(
        mockProjectStore as any,
        mockNavigate as any,
        'project-1',
        'Test question',
        'history-123',
        ['task-1']
      );

      expect(mockProjectStore.replayProject).toHaveBeenCalledWith(
        ['task-1'],
        'Test question',
        'project-1',
        'history-123'
      );
      expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/' });
    });

    it('defaults taskIdsList to [projectId] when not provided', async () => {
      await replayProject(
        mockProjectStore as any,
        mockNavigate as any,
        'project-1',
        'Test question',
        'history-123'
      );

      expect(mockProjectStore.replayProject).toHaveBeenCalledWith(
        ['project-1'],
        'Test question',
        'project-1',
        'history-123'
      );
    });
  });
});
