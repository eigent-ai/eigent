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

import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { presentationForKind } from '@/lib/sessionNavLead';
import {
  listOpenSessionWindows,
  onSessionWindowMessage,
  postSessionWindowMessage,
  type SessionWindowTarget,
} from '@/lib/sessionWindows';
import { useAuthStore } from '@/store/authStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { useSessionSplitViewStore } from '@/store/sessionSplitViewStore';
import { useSessionWindowsStore } from '@/store/sessionWindowsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect } from 'react';

/** How long a Session may be missing before it counts as deleted. */
export const DELETE_CONFIRM_DELAY_MS = 2000;

/**
 * Main window: tracks which Sessions are open in their own window, answers
 * their requests, and closes a window whose Session was deleted here.
 */
export function useMainWindowSessionWindows() {
  useEffect(() => {
    const windows = useSessionWindowsStore.getState();
    const stopListening = onSessionWindowMessage((message) => {
      switch (message.type) {
        case 'opened': {
          windows.markOpen(message.projectId);
          moveFocusOffWindowedSession(message.projectId);
          return;
        }
        case 'closed':
          windows.markClosed(message.projectId);
          return;
        case 'open-in-main':
          useSessionWindowsStore.getState().requestOpenInMain(message);
          return;
        case 'session-control':
          useSessionControlsStore
            .getState()
            .requestAction(message.action, message.projectId);
          return;
        case 'nav-lead':
          useProjectRuntimeStore
            .getState()
            .setProjectNavLead(
              message.projectId,
              presentationForKind(message.kind, message.spin)
            );
          return;
        default:
          return;
      }
    });

    // Desktop knows its windows; web tabs answer the roll call.
    void listOpenSessionWindows().then((ids) => {
      if (ids) useSessionWindowsStore.getState().setOpen(ids);
    });
    postSessionWindowMessage({ type: 'who-is-open' });

    // A deleted Session leaves the split and closes its window. Reloading a
    // Session's history removes and recreates its entry, so a Session counts
    // as deleted only when it is still missing a moment later.
    const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
    const confirmDelete = (projectId: string, spaceId: string) => {
      pendingDeletes.delete(projectId);
      if (useSpaceStore.getState().projectIdIndex[projectId]) return;
      useSessionSplitViewStore.getState().forgetSession(projectId);
      if (useSessionWindowsStore.getState().openProjectIds.includes(projectId))
        postSessionWindowMessage({ type: 'close-window', spaceId, projectId });
    };
    const stopWatchingDeletes = useSpaceStore.subscribe((state, previous) => {
      if (state.projectIdIndex === previous.projectIdIndex) return;
      for (const [projectId, spaceId] of Object.entries(
        previous.projectIdIndex
      )) {
        if (state.projectIdIndex[projectId] || pendingDeletes.has(projectId))
          continue;
        pendingDeletes.set(
          projectId,
          setTimeout(
            () => confirmDelete(projectId, spaceId),
            DELETE_CONFIRM_DELAY_MS
          )
        );
      }
    });

    return () => {
      stopListening();
      stopWatchingDeletes();
      pendingDeletes.forEach((timer) => clearTimeout(timer));
    };
  }, []);
}

/**
 * Main window: after it starts a Run for a Session that is open in its own
 * window, ask that window to reload the Session so the Run shows there.
 */
export function notifySessionWindowOfRun(projectId: string) {
  if (!useSessionWindowsStore.getState().openProjectIds.includes(projectId))
    return;
  const spaceId = useSpaceStore.getState().projectIdIndex[projectId];
  if (!spaceId) return;
  postSessionWindowMessage({ type: 'reload-session', spaceId, projectId });
}

/** A windowed Session leaves the main window: focus moves to another pane. */
function moveFocusOffWindowedSession(projectId: string) {
  const runtime = useProjectRuntimeStore.getState();
  if (runtime.activeProjectId !== projectId) return;
  const spaceId = useSpaceStore.getState().projectIdIndex[projectId];
  const panes = spaceId
    ? (useSessionSplitViewStore.getState().panesBySpaceId[spaceId] ?? [])
    : [];
  const windowed = useSessionWindowsStore.getState().openProjectIds;
  const index = panes.indexOf(projectId);
  const remaining = panes.filter(
    (id) => id !== projectId && !windowed.includes(id)
  );
  if (index < 0 || remaining.length === 0) return;
  runtime.setActiveProject(remaining[Math.max(0, index - 1)] ?? remaining[0]);
}

/**
 * Session window: announces itself, reports its sidebar status, forwards
 * Session menu requests the main window confirms, and closes on request.
 */
export function useSessionWindowLink(target: SessionWindowTarget | null) {
  const spaceId = target?.spaceId;
  const projectId = target?.projectId;
  useEffect(() => {
    if (!spaceId || !projectId) return;
    const self = { spaceId, projectId };
    const announce = () =>
      postSessionWindowMessage({ type: 'opened', ...self });
    announce();

    // The main window started a Run here (automation, trigger or Remote
    // Control); read the Session again so the Run shows. Requests that land
    // while a reload is running fold into it.
    let reloading = false;
    const reloadSession = () => {
      if (reloading) return;
      reloading = true;
      const runtime = useProjectRuntimeStore.getState();
      runtime.setHistoryLoadIncomplete(projectId, true);
      void ensureProjectRuntimeLoaded(runtime, projectId, {
        requireActiveSelection: true,
      }).finally(() => {
        reloading = false;
      });
    };

    const stopListening = onSessionWindowMessage((message) => {
      if (message.type === 'who-is-open') announce();
      else if (message.projectId !== projectId) return;
      else if (message.type === 'close-window') window.close();
      else if (message.type === 'reload-session') reloadSession();
    });

    let lastLead = '';
    const reportLead = () => {
      const lead =
        useProjectRuntimeStore.getState().navLeadByProjectId[projectId];
      if (!lead) return;
      const key = `${lead.kind}:${lead.spin ? 1 : 0}`;
      if (key === lastLead) return;
      lastLead = key;
      postSessionWindowMessage({
        type: 'nav-lead',
        ...self,
        kind: lead.kind,
        spin: lead.spin,
      });
    };
    reportLead();
    const stopReportingLead = useProjectRuntimeStore.subscribe(reportLead);

    // Rename, End and Delete confirm in the main window, which owns them.
    let handledRequest =
      useSessionControlsStore.getState().request?.sequence ?? 0;
    const stopForwarding = useSessionControlsStore.subscribe((state) => {
      const request = state.request;
      if (!request || request.sequence <= handledRequest) return;
      handledRequest = request.sequence;
      postSessionWindowMessage({
        type: 'session-control',
        action: request.action,
        spaceId,
        projectId: request.projectId,
      });
    });

    // Signing out or switching account in the main window ends this window:
    // its Session belongs to the account it opened with. A token refresh for
    // the same account keeps it open.
    const account = useAuthStore.getState();
    const openedAs = { userId: account.user_id, email: account.email };
    const stopWatchingAccount = useAuthStore.subscribe((state) => {
      if (
        !state.token ||
        state.user_id !== openedAs.userId ||
        state.email !== openedAs.email
      )
        window.close();
    });

    const refreshPinned = () =>
      useSessionControlsStore.getState().refreshPinned();
    window.addEventListener('storage', refreshPinned);

    const goodbye = () => postSessionWindowMessage({ type: 'closed', ...self });
    window.addEventListener('pagehide', goodbye);
    return () => {
      stopListening();
      stopReportingLead();
      stopForwarding();
      stopWatchingAccount();
      window.removeEventListener('storage', refreshPinned);
      window.removeEventListener('pagehide', goodbye);
    };
  }, [spaceId, projectId]);
}
