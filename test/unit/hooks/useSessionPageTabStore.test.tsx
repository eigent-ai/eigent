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

import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import { SessionPaneProvider } from '@/hooks/useSessionPane';
import { hasSessionPane } from '@/lib/sessionPaneLifetime';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { act, render, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';

beforeEach(() => {
  usePageTabStore.setState({
    sessionPreviewProjectId: 'a',
    sessionPreviewByProject: {},
    sessionPreviewOpeningByProject: {},
    previewBrowserViewportByProject: {},
    workspaceChatDraftRequest: null,
    workspaceReviewHandoffs: [],
  });
});

it('keeps preview reads, actions and delayed callbacks bound to their pane', () => {
  const a = renderHook(() => useSessionPageTabStore((s) => s), {
    wrapper: ({ children }) => (
      <SessionPaneProvider projectId="a">{children}</SessionPaneProvider>
    ),
  });
  const b = renderHook(() => useSessionPageTabStore((s) => s), {
    wrapper: ({ children }) => (
      <SessionPaneProvider projectId="b">{children}</SessionPaneProvider>
    ),
  });
  const openInA = a.result.current.openBrowserPreview;
  act(() => {
    a.result.current.openPreviewTab('terminal');
    b.result.current.openBrowserPreview('https://b.example');
    usePageTabStore.getState().setSessionPreviewProject('b');
    openInA('https://a.example');
  });
  expect(
    getSessionPreviewSlice(a.result.current).tabs.map((t) => t.type)
  ).toEqual(['terminal', 'browser']);
  expect(getSessionPreviewSlice(b.result.current).tabs).toHaveLength(1);
  expect(getSessionPreviewSlice(a.result.current).tabs.at(-1)).toMatchObject({
    url: 'https://a.example/',
  });
  expect(getSessionPreviewSlice(b.result.current).tabs[0]).toMatchObject({
    url: 'https://b.example/',
  });
  act(() => a.result.current.closeSessionPreview());
  expect(getSessionPreviewSlice(a.result.current).open).toBe(false);
  expect(getSessionPreviewSlice(b.result.current).open).toBe(true);
  expect(usePageTabStore.getState().sessionPreviewProjectId).toBe('b');
});

it('records entrances and browser bounds separately and addresses review handoffs', () => {
  const a = renderHook(() => useSessionPageTabStore((s) => s), {
    wrapper: ({ children }) => (
      <SessionPaneProvider projectId="a">{children}</SessionPaneProvider>
    ),
  });
  const b = renderHook(() => useSessionPageTabStore((s) => s), {
    wrapper: ({ children }) => (
      <SessionPaneProvider projectId="b">{children}</SessionPaneProvider>
    ),
  });
  const boundsA = { x: 0, y: 0, width: 600, height: 500 };
  const boundsB = { ...boundsA, x: 600 };
  act(() => {
    a.result.current.toggleSessionPreview({ immediate: true });
    b.result.current.toggleSessionPreview();
    a.result.current.setPreviewBrowserViewport(boundsA);
    b.result.current.setPreviewBrowserViewport(boundsB);
    b.result.current.requestWorkspaceChatDraft('Review feedback');
  });
  expect(a.result.current.sessionPreviewOpening).toMatchObject({
    projectId: 'a',
    immediate: true,
  });
  expect(b.result.current.sessionPreviewOpening).toMatchObject({
    projectId: 'b',
    immediate: false,
  });
  expect(usePageTabStore.getState().previewBrowserViewportByProject).toEqual({
    a: boundsA,
    b: boundsB,
  });
  expect(usePageTabStore.getState().workspaceChatDraftRequest?.projectId).toBe(
    'b'
  );
  act(() => a.result.current.setPreviewBrowserViewport(null));
  expect(usePageTabStore.getState().previewBrowserViewportByProject).toEqual({
    b: boundsB,
  });
});

it('retains only panes that own their Session', () => {
  // A pane following the active Session would still hold the outgoing id
  // when setActiveProject evicts, so it must not retain.
  const following = render(
    <SessionPaneProvider projectId="followed" retain={false}>
      {null}
    </SessionPaneProvider>
  );
  const owned = render(
    <SessionPaneProvider projectId="owned">{null}</SessionPaneProvider>
  );
  expect(hasSessionPane('followed')).toBe(false);
  expect(hasSessionPane('owned')).toBe(true);
  following.unmount();
  owned.unmount();
  expect(hasSessionPane('owned')).toBe(false);
});
