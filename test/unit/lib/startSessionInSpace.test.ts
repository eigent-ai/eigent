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

import '@/api/http';

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { startSessionInSpace } from '@/lib/startSessionInSpace';
import { getAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  resetSessionDrafts,
  sessionDraftKey,
  useSessionDraftStore,
} from '@/store/sessionDraftStore';
import { isSessionStarting } from '@/store/sessionStartStore';
import { useSpaceStore } from '@/store/spaceStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const chat = {
    activeTaskId: 'task-1' as string | null,
    setHasMessages: vi.fn(),
    setAttaches: vi.fn(),
    startTask: vi.fn(),
    setHasWaitComfirm: vi.fn(),
  };
  return { chat, startingDuringStart: false, setActiveSpace: vi.fn() };
});

vi.mock('@/lib/spaceProject', () => ({
  createSyncedProjectInSpace: vi.fn(),
}));

const files = [{ fileName: 'brief.pdf', filePath: '/work/brief.pdf' }];

describe('startSessionInSpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionDrafts();
    mocks.chat.activeTaskId = 'task-1';
    mocks.chat.startTask.mockImplementation(async () => {
      mocks.startingDuringStart = isSessionStarting('new-session');
    });
    useProjectRuntimeStore.setState({
      projects: { 'new-session': { id: 'new-session' } } as never,
      getActiveChatStore: (() => ({ getState: () => mocks.chat })) as never,
      getComposerThinkingEffort: (() => 'high') as never,
    });
    useSpaceStore.setState({
      // Selecting the Space syncs it from the server; that is not under test.
      setActiveSpace: mocks.setActiveSpace,
      activeSpaceId: 'space-1',
      spaces: {
        'space-1': {
          id: 'space-1',
          name: 'Research',
          sourceType: 'folder',
          rootPath: '/work/research',
          status: 'active',
          schemaVersion: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      },
    });
    vi.mocked(createSyncedProjectInSpace).mockImplementation(
      async ({ onLocalProjectCreated }) => {
        const result = { projectId: 'new-session', spaceId: 'space-1' };
        onLocalProjectCreated?.(result);
        return result;
      }
    );
  });

  it('creates the Session in the Space, opens it, and starts its first task', async () => {
    const onOpened = vi.fn(() => {
      // Opened before the task starts, marked as a started Session.
      expect(mocks.chat.startTask).not.toHaveBeenCalled();
      expect(isSessionStarting('new-session')).toBe(true);
    });

    await expect(
      startSessionInSpace({
        spaceId: 'space-1',
        message: 'Draft the launch plan',
        files,
        sessionMode: 'workforce',
        onOpened,
        onRejected: vi.fn(),
      })
    ).resolves.toBe('new-session');

    expect(createSyncedProjectInSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        name: 'Draft the launch plan',
        mode: 'workforce',
        workdirMode: 'direct-write',
        metadata: { createdFrom: 'space_page_chat', thinkingEffort: 'high' },
        // An account change during creation rejects the Session.
        expectedAccountKey: getAccountEnvironmentKey(getAuthStore()),
      })
    );
    expect(onOpened).toHaveBeenCalledWith('new-session');
    expect(mocks.setActiveSpace).toHaveBeenCalledWith('space-1');
    expect(
      usePageTabStore.getState().sessionTaskStartedProjectIds['new-session']
    ).toBe(true);
    expect(mocks.chat.startTask).toHaveBeenCalledWith(
      'task-1',
      undefined,
      undefined,
      undefined,
      'Draft the launch plan',
      files,
      undefined,
      'new-session',
      'workforce',
      { awaitAdmission: true }
    );
    expect(mocks.startingDuringStart).toBe(true);
    expect(mocks.chat.setHasWaitComfirm).toHaveBeenCalledWith('task-1', true);
    expect(mocks.chat.setAttaches).toHaveBeenLastCalledWith('task-1', []);
    // The start settled, so the Session's composer is free again.
    expect(isSessionStarting('new-session')).toBe(false);
  });

  it('keeps the message in the opened Session when its first task fails', async () => {
    mocks.chat.startTask.mockRejectedValue(new Error('No credits'));

    await expect(
      startSessionInSpace({
        spaceId: 'space-1',
        message: 'Draft the launch plan',
        files: [],
        sessionMode: 'single-agent',
        onOpened: vi.fn(),
        onRejected: vi.fn(),
      })
    ).rejects.toThrow('No credits');

    const key = sessionDraftKey(
      getAccountEnvironmentKey(getAuthStore()),
      'new-session'
    );
    expect(useSessionDraftStore.getState().drafts[key]?.text).toBe(
      'Draft the launch plan'
    );
    expect(isSessionStarting('new-session')).toBe(false);
  });

  it('reports a Session the server refused after it opened', async () => {
    vi.mocked(createSyncedProjectInSpace).mockImplementation(
      async ({ onLocalProjectCreated, onLocalProjectRejected }) => {
        const result = { projectId: 'new-session', spaceId: 'space-1' };
        onLocalProjectCreated?.(result);
        onLocalProjectRejected?.(result);
        throw new Error('Rejected');
      }
    );
    const onRejected = vi.fn();

    await expect(
      startSessionInSpace({
        spaceId: 'space-1',
        message: 'Draft the launch plan',
        files: [],
        sessionMode: 'single-agent',
        onOpened: vi.fn(),
        onRejected,
      })
    ).rejects.toThrow('Rejected');
    expect(onRejected).toHaveBeenCalledWith('new-session');
    expect(mocks.chat.startTask).not.toHaveBeenCalled();
  });

  it('opens nothing when the Session has no chat to start in', async () => {
    mocks.chat.activeTaskId = null;
    const onOpened = vi.fn();

    await expect(
      startSessionInSpace({
        spaceId: 'space-1',
        message: 'Draft the launch plan',
        files: [],
        sessionMode: 'single-agent',
        onOpened,
        onRejected: vi.fn(),
      })
    ).rejects.toThrow('No active Project chat available');
    expect(onOpened).not.toHaveBeenCalled();
  });
});
