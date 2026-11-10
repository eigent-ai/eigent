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
  type Dispatch,
  type SetStateAction,
} from 'react';

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
 * It can then change the draft only while the draft is exactly as that
 * composer last saw it, so a late result never clears or overwrites newer
 * text.
 */
export function useSessionDraft(
  accountKey: string,
  projectId: string | null | undefined
) {
  const key = projectId ? sessionDraftKey(accountKey, projectId) : null;
  const draft = useSessionDraftStore((state) =>
    key ? state.drafts[key] : undefined
  );
  const mountedRef = useRef(false);
  // The draft of `key` as this composer last rendered or wrote it.
  const seenRef = useRef({ key, draft });
  useLayoutEffect(() => {
    seenRef.current = { key, draft };
  }, [key, draft]);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const update = useCallback(
    (change: (current: SessionDraft) => Partial<SessionDraft>) => {
      if (!key) return;
      const { drafts } = useSessionDraftStore.getState();
      const current = drafts[key];
      const seen = seenRef.current;
      if (!mountedRef.current && (seen.key !== key || seen.draft !== current))
        return;
      const base = current ?? EMPTY_SESSION_DRAFT;
      const next = { ...base, ...change(base) };
      seenRef.current = { key, draft: next };
      useSessionDraftStore.setState({ drafts: { ...drafts, [key]: next } });
    },
    [key]
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

  return {
    text: draft?.text ?? EMPTY_SESSION_DRAFT.text,
    setText,
    reviewHandoffIds:
      draft?.reviewHandoffIds ?? EMPTY_SESSION_DRAFT.reviewHandoffIds,
    setReviewHandoffIds,
  };
}
