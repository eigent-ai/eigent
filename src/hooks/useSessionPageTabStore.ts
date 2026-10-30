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

import { useSessionPane } from '@/hooks/useSessionPane';
import { usePageTabStore, type PageTabState } from '@/store/pageTabStore';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

/** Preview actions capture their owner, including callbacks settling after focus moves. */
export function useSessionPageTabStore<T>(
  selector: (state: PageTabState) => T
): T {
  const pane = useSessionPane();
  const id = pane?.previewScopeId;
  const actions = useMemo((): Partial<PageTabState> => {
    if (id === undefined) return {};
    const state = () => usePageTabStore.getState();
    return {
      requestWorkspaceChatDraft: (content, source, targetProjectId, options) =>
        state().requestWorkspaceChatDraft(
          content,
          source,
          targetProjectId === undefined ? pane?.projectId : targetProjectId,
          options
        ),
      toggleSessionPreview: (options) =>
        state().toggleSessionPreview(options, id),
      openPreviewTab: (kind, options) =>
        state().openPreviewTab(kind, options, id),
      addChooserPreviewTab: () => state().addChooserPreviewTab(id),
      choosePreviewTabType: (tabId, kind) =>
        state().choosePreviewTabType(tabId, kind, id),
      openFilePreview: (file) => state().openFilePreview(file, id),
      openReviewPreview: (input) => state().openReviewPreview(input, id),
      updateReviewComments: (tabId, comments) =>
        state().updateReviewComments(tabId, comments, id),
      setReviewIdentity: (tabId, identity, targetKey) =>
        state().setReviewIdentity(tabId, identity, targetKey, id),
      openBrowserPreview: (url, projectId) =>
        state().openBrowserPreview(
          url,
          projectId === undefined ? id : projectId
        ),
      openAgentTerminalPreview: (sourceId, title, fromTabId) =>
        state().openAgentTerminalPreview(sourceId, title, fromTabId, id),
      selectSessionPreviewTab: (tabId) =>
        state().selectSessionPreviewTab(tabId, id),
      closeSessionPreviewTab: (tabId) =>
        state().closeSessionPreviewTab(tabId, id),
      updateBrowserPreviewTab: (tabId, patch) =>
        state().updateBrowserPreviewTab(tabId, patch, id),
      closeSessionPreview: () => state().closeSessionPreview(id),
      resetSessionPreview: () => state().resetSessionPreview(id),
      setPreviewBrowserViewport: (rect) =>
        state().setPreviewBrowserViewport(rect, id),
    };
  }, [id, pane?.projectId]);
  return usePageTabStore(
    useShallow((state) =>
      selector(
        id === undefined
          ? state
          : {
              ...state,
              ...actions,
              sessionPreviewProjectId: id,
              sessionPreviewOpening: id
                ? (state.sessionPreviewOpeningByProject[id] ?? null)
                : null,
              previewBrowserViewport: id
                ? (state.previewBrowserViewportByProject[id] ?? null)
                : null,
            }
      )
    )
  );
}
