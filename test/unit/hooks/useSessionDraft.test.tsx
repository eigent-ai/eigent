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

import { useSessionDraft } from '@/hooks/useSessionDraft';
import { resetSessionDrafts } from '@/store/sessionDraftStore';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

const draftFor = (accountKey: string, projectId: string | null) =>
  renderHook(() => useSessionDraft(accountKey, projectId));

describe('useSessionDraft', () => {
  beforeEach(() => resetSessionDrafts());

  it('keeps drafts separate per Session and per account', () => {
    const first = draftFor('account-a', 'session-1');
    act(() => {
      first.result.current.setText('Session 1 text');
      first.result.current.setReviewHandoffIds(['handoff-1']);
    });
    first.unmount();

    expect(draftFor('account-a', 'session-1').result.current).toMatchObject({
      text: 'Session 1 text',
      reviewHandoffIds: ['handoff-1'],
    });
    expect(draftFor('account-a', 'session-2').result.current).toMatchObject({
      text: '',
      reviewHandoffIds: [],
    });
    expect(draftFor('account-b', 'session-1').result.current.text).toBe('');
  });

  it('applies functional updates to the current draft', () => {
    const draft = draftFor('account-a', 'session-1');
    act(() => draft.result.current.setText('First'));
    act(() => draft.result.current.setText((current) => `${current} second`));
    expect(draft.result.current.text).toBe('First second');
  });

  it('lets a left composer settle only a draft nobody edited since', () => {
    const left = draftFor('account-a', 'session-1');
    act(() => left.result.current.setText('Sent text'));
    const { setText: settleLeftDraft } = left.result.current;
    left.unmount();

    act(() => settleLeftDraft(''));
    const returned = draftFor('account-a', 'session-1');
    expect(returned.result.current.text).toBe('');

    act(() => returned.result.current.setText('Newer text'));
    act(() => settleLeftDraft(''));
    expect(returned.result.current.text).toBe('Newer text');
  });

  it('lets a composer that restored a draft settle it after leaving', () => {
    const typed = draftFor('account-a', 'session-1');
    act(() => {
      typed.result.current.setText('Typed on an earlier visit');
      typed.result.current.setReviewHandoffIds(['handoff-1']);
    });
    typed.unmount();

    const restored = draftFor('account-a', 'session-1');
    expect(restored.result.current.text).toBe('Typed on an earlier visit');
    const { setText: settleText, setReviewHandoffIds: settleReviewHandoffIds } =
      restored.result.current;
    restored.unmount();

    act(() => {
      settleText('');
      settleReviewHandoffIds([]);
    });
    expect(draftFor('account-a', 'session-1').result.current).toMatchObject({
      text: '',
      reviewHandoffIds: [],
    });
  });

  it('ignores edits while no Session is selected', () => {
    const draft = draftFor('account-a', null);
    act(() => draft.result.current.setText('Nowhere'));
    expect(draft.result.current.text).toBe('');
  });
});
