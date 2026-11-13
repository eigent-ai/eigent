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

import type { FileAttachment } from '@/components/ChatBox/BottomBox';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { createSyncedProjectInSpace } from '@/lib/spaceProject';
import { getAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import {
  EMPTY_SESSION_DRAFT,
  sessionDraftKey,
  useSessionDraftStore,
} from '@/store/sessionDraftStore';
import { useSessionStartStore } from '@/store/sessionStartStore';
import { useSpaceStore } from '@/store/spaceStore';
import type { SessionModeType } from '@/types/constants';

export interface StartSessionInSpaceInput {
  spaceId: string;
  /** Trimmed first message; it also names the Session. */
  message: string;
  files: FileAttachment[];
  sessionMode: SessionModeType;
  /**
   * The new Session exists and is selected; show it. Its first task keeps
   * starting behind it.
   */
  onOpened: (projectId: string) => void;
  /**
   * The server refused the Session after it opened, so it is gone again.
   * Nothing was sent; the caller decides where the message goes back to.
   */
  onRejected: (projectId: string) => void;
}

/**
 * Starts a Session in a Space with its first message, outside the New session
 * composer, the same way that composer does: the Session is created in the
 * Space, opened at once, and its first task starts behind it. A failure after
 * the Session opened leaves it open with its error and the message waiting in
 * its composer.
 *
 * Callers check the model and usage first, as the composer does.
 */
export async function startSessionInSpace({
  spaceId,
  message,
  files,
  sessionMode,
  onOpened,
  onRejected,
}: StartSessionInSpaceInput): Promise<string> {
  const accountKey = getAccountEnvironmentKey(getAuthStore());
  const projectStore = useProjectRuntimeStore.getState();
  const space = useSpaceStore.getState().spaces[spaceId];
  const thinkingEffort = projectStore.getComposerThinkingEffort();
  let openedProjectId: string | null = null;

  try {
    const synced = await createSyncedProjectInSpace({
      projectStore,
      // A Session created after the account changed is rejected, not kept.
      expectedAccountKey: accountKey,
      spaceId,
      name: message.slice(0, 120),
      mode: sessionMode,
      workdirMode: isLocalWorkspaceSpace(space)
        ? 'direct-write'
        : 'artifact-only',
      metadata: {
        createdFrom: 'space_page_chat',
        ...(thinkingEffort !== undefined ? { thinkingEffort } : {}),
      },
      onLocalProjectCreated: ({ projectId }) => {
        // The Session page opens Activity for a started Session, so mark
        // the first task started before showing it.
        const chat = useProjectRuntimeStore
          .getState()
          .getActiveChatStore(projectId)
          ?.getState();
        if (!chat?.activeTaskId) return;
        chat.setHasMessages(chat.activeTaskId, true);
        usePageTabStore.getState().markSessionTaskStarted(projectId);
        // Its composer waits until this start settles.
        useSessionStartStore.getState().markSessionStarting(projectId);
        openedProjectId = projectId;
        onOpened(projectId);
      },
      onLocalProjectRejected: ({ projectId }) => {
        if (openedProjectId === projectId) onRejected(projectId);
      },
    });
    useSpaceStore.getState().setActiveSpace(synced.spaceId);

    const chat = useProjectRuntimeStore
      .getState()
      .getActiveChatStore(synced.projectId)
      ?.getState();
    if (!chat?.activeTaskId) {
      throw new Error('No active Project chat available');
    }
    const taskId = chat.activeTaskId;
    chat.setHasMessages(taskId, true);
    // A plain copy, as New session sends it; the chat store keeps its own.
    const attachments = JSON.parse(JSON.stringify(files)) || [];
    chat.setAttaches(taskId, attachments);
    // Key, usage and admission failures keep the user in the new Session.
    await chat.startTask(
      taskId,
      undefined,
      undefined,
      undefined,
      message,
      attachments,
      undefined,
      synced.projectId,
      sessionMode,
      { awaitAdmission: true }
    );
    chat.setHasWaitComfirm(taskId, true);
    chat.setAttaches(taskId, []);
    return synced.projectId;
  } catch (error) {
    if (openedProjectId) keepMessageInSession(accountKey, openedProjectId);
    throw error;
  } finally {
    if (openedProjectId) {
      useSessionStartStore.getState().clearSessionStarting(openedProjectId);
    }
  }

  /** A Session that failed to start keeps its message for a retry. */
  function keepMessageInSession(account: string, projectId: string) {
    if (getAccountEnvironmentKey(getAuthStore()) !== account) return;
    if (!useProjectRuntimeStore.getState().projects[projectId]) return;
    const key = sessionDraftKey(account, projectId);
    const { drafts } = useSessionDraftStore.getState();
    if (drafts[key]?.text) return;
    useSessionDraftStore.setState({
      drafts: {
        ...drafts,
        [key]: { ...(drafts[key] ?? EMPTY_SESSION_DRAFT), text: message },
      },
    });
  }
}
