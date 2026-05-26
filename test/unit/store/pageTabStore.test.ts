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
 * PageTabStore Unit Tests
 *
 * Tests page tab and workspace navigation state:
 * - Initial state defaults
 * - setActiveTab
 * - setActiveWorkspaceTab with auto mark-as-viewed
 * - setChatPanelPosition
 * - setHasTriggers / setHasAgentFiles
 * - markTabAsViewed / markTabAsUnviewed (unviewedTabs Set management)
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { usePageTabStore } from '../../../src/store/pageTabStore';

describe('PageTabStore', () => {
  beforeEach(() => {
    usePageTabStore.setState({
      activeTab: 'tasks',
      activeWorkspaceTab: 'workforce',
      chatPanelPosition: 'left',
      hasTriggers: false,
      hasAgentFiles: false,
      unviewedTabs: new Set(),
    });
  });

  // ─── Initial State ────────────────────────────────────────────────

  describe('Initial State', () => {
    it('should have activeTab "tasks"', () => {
      const { result } = renderHook(() => usePageTabStore());

      expect(result.current.activeTab).toBe('tasks');
    });

    it('should have activeWorkspaceTab "workforce"', () => {
      const { result } = renderHook(() => usePageTabStore());

      expect(result.current.activeWorkspaceTab).toBe('workforce');
    });

    it('should have chatPanelPosition "left"', () => {
      const { result } = renderHook(() => usePageTabStore());

      expect(result.current.chatPanelPosition).toBe('left');
    });

    it('should have hasTriggers false', () => {
      const { result } = renderHook(() => usePageTabStore());

      expect(result.current.hasTriggers).toBe(false);
    });

    it('should have hasAgentFiles false', () => {
      const { result } = renderHook(() => usePageTabStore());

      expect(result.current.hasAgentFiles).toBe(false);
    });

    it('should have an empty unviewedTabs Set', () => {
      const { result } = renderHook(() => usePageTabStore());

      expect(result.current.unviewedTabs.size).toBe(0);
    });
  });

  // ─── setActiveTab ─────────────────────────────────────────────────

  describe('setActiveTab', () => {
    it('should set activeTab to "trigger"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setActiveTab('trigger');
      });

      expect(result.current.activeTab).toBe('trigger');
    });

    it('should set activeTab back to "tasks"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setActiveTab('trigger');
      });

      act(() => {
        result.current.setActiveTab('tasks');
      });

      expect(result.current.activeTab).toBe('tasks');
    });
  });

  // ─── setActiveWorkspaceTab ────────────────────────────────────────

  describe('setActiveWorkspaceTab', () => {
    it('should set activeWorkspaceTab to "triggers"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setActiveWorkspaceTab('triggers');
      });

      expect(result.current.activeWorkspaceTab).toBe('triggers');
    });

    it('should set activeWorkspaceTab to "inbox"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setActiveWorkspaceTab('inbox');
      });

      expect(result.current.activeWorkspaceTab).toBe('inbox');
    });

    it('should set activeWorkspaceTab to "workforce"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setActiveWorkspaceTab('triggers');
      });

      act(() => {
        result.current.setActiveWorkspaceTab('workforce');
      });

      expect(result.current.activeWorkspaceTab).toBe('workforce');
    });

    it('should mark the tab as viewed when switching to "triggers"', () => {
      const { result } = renderHook(() => usePageTabStore());

      // Mark triggers as unviewed first
      act(() => {
        result.current.markTabAsUnviewed('triggers');
      });

      expect(result.current.unviewedTabs.has('triggers')).toBe(true);

      // Switch to triggers tab
      act(() => {
        result.current.setActiveWorkspaceTab('triggers');
      });

      expect(result.current.unviewedTabs.has('triggers')).toBe(false);
    });

    it('should mark the tab as viewed when switching to "inbox"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('inbox');
      });

      expect(result.current.unviewedTabs.has('inbox')).toBe(true);

      act(() => {
        result.current.setActiveWorkspaceTab('inbox');
      });

      expect(result.current.unviewedTabs.has('inbox')).toBe(false);
    });

    it('should not modify unviewedTabs when switching to "workforce"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
        result.current.markTabAsUnviewed('inbox');
      });

      const sizeBefore = result.current.unviewedTabs.size;

      act(() => {
        result.current.setActiveWorkspaceTab('workforce');
      });

      expect(result.current.unviewedTabs.size).toBe(sizeBefore);
      expect(result.current.unviewedTabs.has('triggers')).toBe(true);
      expect(result.current.unviewedTabs.has('inbox')).toBe(true);
    });
  });

  // ─── setChatPanelPosition ─────────────────────────────────────────

  describe('setChatPanelPosition', () => {
    it('should set chatPanelPosition to "right"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setChatPanelPosition('right');
      });

      expect(result.current.chatPanelPosition).toBe('right');
    });

    it('should set chatPanelPosition to "left"', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setChatPanelPosition('right');
      });

      act(() => {
        result.current.setChatPanelPosition('left');
      });

      expect(result.current.chatPanelPosition).toBe('left');
    });
  });

  // ─── setHasTriggers ───────────────────────────────────────────────

  describe('setHasTriggers', () => {
    it('should set hasTriggers to true', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setHasTriggers(true);
      });

      expect(result.current.hasTriggers).toBe(true);
    });

    it('should set hasTriggers to false', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setHasTriggers(true);
      });

      act(() => {
        result.current.setHasTriggers(false);
      });

      expect(result.current.hasTriggers).toBe(false);
    });
  });

  // ─── setHasAgentFiles ─────────────────────────────────────────────

  describe('setHasAgentFiles', () => {
    it('should set hasAgentFiles to true', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setHasAgentFiles(true);
      });

      expect(result.current.hasAgentFiles).toBe(true);
    });

    it('should set hasAgentFiles to false', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.setHasAgentFiles(true);
      });

      act(() => {
        result.current.setHasAgentFiles(false);
      });

      expect(result.current.hasAgentFiles).toBe(false);
    });
  });

  // ─── markTabAsViewed ──────────────────────────────────────────────

  describe('markTabAsViewed', () => {
    it('should remove a tab from unviewedTabs', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
      });

      expect(result.current.unviewedTabs.has('triggers')).toBe(true);

      act(() => {
        result.current.markTabAsViewed('triggers');
      });

      expect(result.current.unviewedTabs.has('triggers')).toBe(false);
    });

    it('should be a no-op when the tab is not in unviewedTabs', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsViewed('triggers');
      });

      expect(result.current.unviewedTabs.size).toBe(0);
    });

    it('should only remove the specified tab, leaving others', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
        result.current.markTabAsUnviewed('inbox');
      });

      expect(result.current.unviewedTabs.size).toBe(2);

      act(() => {
        result.current.markTabAsViewed('triggers');
      });

      expect(result.current.unviewedTabs.size).toBe(1);
      expect(result.current.unviewedTabs.has('triggers')).toBe(false);
      expect(result.current.unviewedTabs.has('inbox')).toBe(true);
    });
  });

  // ─── markTabAsUnviewed ────────────────────────────────────────────

  describe('markTabAsUnviewed', () => {
    it('should add a tab to unviewedTabs', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
      });

      expect(result.current.unviewedTabs.has('triggers')).toBe(true);
    });

    it('should add multiple tabs to unviewedTabs', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
        result.current.markTabAsUnviewed('inbox');
      });

      expect(result.current.unviewedTabs.size).toBe(2);
      expect(result.current.unviewedTabs.has('triggers')).toBe(true);
      expect(result.current.unviewedTabs.has('inbox')).toBe(true);
    });

    it('should be a no-op when the tab is already unviewed (Set dedup)', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
        result.current.markTabAsUnviewed('triggers');
      });

      expect(result.current.unviewedTabs.size).toBe(1);
    });
  });

  // ─── Combined unviewed tab workflows ──────────────────────────────

  describe('Unviewed tab lifecycle', () => {
    it('should handle mark-unviewed then mark-viewed cycle', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('inbox');
      });
      expect(result.current.unviewedTabs.has('inbox')).toBe(true);

      act(() => {
        result.current.markTabAsViewed('inbox');
      });
      expect(result.current.unviewedTabs.has('inbox')).toBe(false);

      act(() => {
        result.current.markTabAsUnviewed('inbox');
      });
      expect(result.current.unviewedTabs.has('inbox')).toBe(true);
    });

    it('should auto-view an unviewed tab when switching to it', () => {
      const { result } = renderHook(() => usePageTabStore());

      act(() => {
        result.current.markTabAsUnviewed('triggers');
        result.current.markTabAsUnviewed('inbox');
      });

      // Switch to triggers — should auto-view it
      act(() => {
        result.current.setActiveWorkspaceTab('triggers');
      });

      expect(result.current.activeWorkspaceTab).toBe('triggers');
      expect(result.current.unviewedTabs.has('triggers')).toBe(false);
      expect(result.current.unviewedTabs.has('inbox')).toBe(true);
    });
  });
});
