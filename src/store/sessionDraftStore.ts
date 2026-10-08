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

import { create } from 'zustand';

/** Unsent composer content of one Session. */
export interface SessionDraft {
  text: string;
  /** Review feedback handed to this draft and not yet sent. */
  reviewHandoffIds: string[];
  /** The composer mount that last edited this draft. */
  editor: symbol | null;
}

type SessionDraftState = {
  /** Keyed by `sessionDraftKey`; held in memory only while the app runs. */
  drafts: Record<string, SessionDraft>;
};

export const EMPTY_SESSION_DRAFT: Readonly<SessionDraft> = Object.freeze({
  text: '',
  reviewHandoffIds: [],
  editor: null,
});

export const useSessionDraftStore = create<SessionDraftState>()(() => ({
  drafts: {},
}));

export function sessionDraftKey(accountKey: string, projectId: string): string {
  return JSON.stringify([accountKey, projectId]);
}

export function resetSessionDrafts(): void {
  useSessionDraftStore.setState({ drafts: {} });
}
