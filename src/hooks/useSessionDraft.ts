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

import {
  EMPTY_SESSION_DRAFT,
  sessionDraftKey,
  useSessionDraftStore,
  type SessionDraft,
} from '@/store/sessionDraftStore';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

type DraftContent = Pick<SessionDraft, 'text' | 'reviewHandoffIds'>;

function resolve<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === 'function'
    ? (value as (previous: T) => T)(current)
    : value;
}

/**
 * The composer draft of the given Session.
 *
 * Switching Sessions remounts the chat surface, so a draft kept in component
 * state would be lost. Each Session keeps its own unsent text and review
 * handoffs here until they are sent or edited away.
 *
 * A composer that has left its Session may still settle an earlier submit.
 * It can then change only a draft that no later composer has edited, so a
 * late result never clears or overwrites newer text.
 */
export function useSessionDraft(
  accountKey: string,
  projectId: string | null | undefined
) {
  const key = projectId ? sessionDraftKey(accountKey, projectId) : null;
  const [editor] = useState(() => Symbol('session-draft-editor'));
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const text = useSessionDraftStore(
    (state) => (key && state.drafts[key]?.text) || EMPTY_SESSION_DRAFT.text
  );
  const reviewHandoffIds = useSessionDraftStore(
    (state) =>
      (key && state.drafts[key]?.reviewHandoffIds) ||
      EMPTY_SESSION_DRAFT.reviewHandoffIds
  );

  const update = useCallback(
    (change: (current: SessionDraft) => Partial<DraftContent>) => {
      if (!key) return;
      useSessionDraftStore.setState((state) => {
        const current = state.drafts[key] ?? EMPTY_SESSION_DRAFT;
        if (!mountedRef.current && current.editor !== editor) return state;
        return {
          drafts: {
            ...state.drafts,
            [key]: { ...current, ...change(current), editor },
          },
        };
      });
    },
    [editor, key]
  );

  const setText = useCallback<Dispatch<SetStateAction<string>>>(
    (value) => update((current) => ({ text: resolve(value, current.text) })),
    [update]
  );
  const setReviewHandoffIds = useCallback<Dispatch<SetStateAction<string[]>>>(
    (value) =>
      update((current) => ({
        reviewHandoffIds: resolve(value, current.reviewHandoffIds),
      })),
    [update]
  );

  return { text, setText, reviewHandoffIds, setReviewHandoffIds };
}
