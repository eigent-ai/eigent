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

import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The preview slice for the currently scoped project. */
function slice() {
  return getSessionPreviewSlice(usePageTabStore.getState());
}

describe('pageTabStore session preview', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      terminalDispose: vi.fn().mockResolvedValue({ success: true }),
    };
    usePageTabStore.setState({
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
      workspaceChatDraftRequest: null,
      workspaceChatDraftRequestSequence: 0,
      workspaceReviewHandoffs: [],
    });
    usePageTabStore.getState().setSessionPreviewProject('project-a');
  });

  it('opens onto a single chooser tab', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();

    expect(slice().open).toBe(true);
    expect(slice().tabs.map((tab) => tab.type)).toEqual(['chooser']);
    expect(slice().activeTabId).toBe(slice().tabs[0].id);
  });

  it('drops mutations when no project is scoped', () => {
    const store = usePageTabStore.getState();
    store.setSessionPreviewProject(null);
    store.toggleSessionPreview();

    expect(slice()).toMatchObject({ open: false, tabs: [] });
    expect(usePageTabStore.getState().sessionPreviewByProject).toEqual({});
  });

  it('turns the chooser into the chosen content kind in place', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;

    store.choosePreviewTabType(chooserId, 'browser');
    expect(slice().tabs).toHaveLength(1);
    const browser = slice().tabs[0];
    expect(browser.type).toBe('browser');
    expect(slice().activeTabId).toBe(browser.id);
    expect(browser.type === 'browser' && browser.webviewId).toContain(
      'session-preview:project-a:'
    );

    // A new chooser (via "+") can become other kinds too.
    store.addChooserPreviewTab();
    const newChooserId = slice().activeTabId!;
    store.choosePreviewTabType(newChooserId, 'canvas');
    expect(slice().tabs.map((tab) => tab.type)).toEqual(['browser', 'canvas']);
  });

  it('opens browser and terminal tabs directly, reusing an existing kind', () => {
    const store = usePageTabStore.getState();

    store.openPreviewTab('browser');
    const browserId = slice().activeTabId;
    expect(slice()).toMatchObject({ open: true });
    expect(slice().tabs.map((tab) => tab.type)).toEqual(['browser']);

    store.closeSessionPreview();
    store.openPreviewTab('browser');
    expect(slice().activeTabId).toBe(browserId);
    expect(slice().tabs).toHaveLength(1);

    store.openPreviewTab('terminal');
    expect(slice().tabs.map((tab) => tab.type)).toEqual([
      'browser',
      'terminal',
    ]);
    expect(slice().tabs[1]).toMatchObject({
      type: 'terminal',
      title: 'Terminal',
    });
  });

  it('exposes every content kind via choosePreviewTabType', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    (['file', 'review', 'terminal', 'canvas'] as const).forEach((kind) => {
      store.addChooserPreviewTab();
      const id = slice().activeTabId!;
      store.choosePreviewTabType(id, kind);
      const active = slice().tabs.find((tab) => tab.id === slice().activeTabId);
      expect(active?.type).toBe(kind);
    });
  });

  it('gives a fresh terminal tab a project-scoped shell id', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;

    store.choosePreviewTabType(chooserId, 'terminal');
    const terminal = slice().tabs[0];
    expect(terminal.type).toBe('terminal');
    expect(terminal.type === 'terminal' && terminal.shellId).toContain(
      'session-shell:project-a:'
    );
    expect(terminal.type === 'terminal' && terminal.agentSourceId).toBeFalsy();
  });

  it('opens agent streams in terminal tabs, converting the chooser in place', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;

    store.openAgentTerminalPreview(
      'chat-1:turn-1:sub-1',
      'Developer Agent',
      chooserId
    );
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0]).toMatchObject({
      type: 'terminal',
      title: 'Developer Agent',
      agentSourceId: 'chat-1:turn-1:sub-1',
    });
    const firstTabId = slice().tabs[0].id;

    // Same stream again — focuses the existing tab instead of duplicating.
    store.addChooserPreviewTab();
    const secondChooser = slice().activeTabId!;
    store.openAgentTerminalPreview(
      'chat-1:turn-1:sub-1',
      'Developer Agent',
      secondChooser
    );
    expect(slice().activeTabId).toBe(firstTabId);
    expect(slice().tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(
      1
    );

    // A different stream without a chooser reference appends a new tab.
    store.openAgentTerminalPreview('chat-1:turn-1:sub-2', 'Developer Agent');
    expect(slice().tabs.filter((tab) => tab.type === 'terminal')).toHaveLength(
      2
    );
  });

  it('does not reuse a read-only agent stream as the interactive terminal', () => {
    const store = usePageTabStore.getState();
    store.openAgentTerminalPreview('chat-1:turn-1:sub-1', 'Developer Agent');
    const agentTabId = slice().activeTabId;

    store.openPreviewTab('terminal');

    const localTerminal = slice().tabs.find(
      (tab) => tab.type === 'terminal' && !tab.agentSourceId
    );
    expect(slice().tabs).toHaveLength(2);
    expect(localTerminal).toMatchObject({
      type: 'terminal',
      title: 'Terminal',
    });
    expect(slice().activeTabId).toBe(localTerminal?.id);
    expect(slice().activeTabId).not.toBe(agentTabId);

    store.closeSessionPreview();
    store.openPreviewTab('terminal');
    expect(slice().tabs).toHaveLength(2);
    expect(slice().activeTabId).toBe(localTerminal?.id);
  });

  it('reuses the chooser tab when a file is opened', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);

    // Chooser replaced in place — no extra tab piled up.
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0]).toMatchObject({
      type: 'file',
      title: 'doc.txt',
      file,
    });
  });

  it('opens and refocuses a Run review without replacing Project review', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().activeTabId!;
    store.choosePreviewTabType(chooserId, 'review');

    const projectReview = slice().tabs[0];
    expect(projectReview).toMatchObject({
      type: 'review',
      title: 'Task review',
      reviewTarget: { scope: 'project', focusRequestId: 0 },
    });

    store.openReviewPreview({ runId: 'run-1', path: './src/app.ts' });
    const runReview = slice().tabs.find(
      (tab) => tab.type === 'review' && tab.reviewTarget?.scope === 'run'
    );
    expect(runReview).toMatchObject({
      type: 'review',
      title: 'Task review',
      reviewTarget: {
        scope: 'run',
        runId: 'run-1',
        focusPath: 'src/app.ts',
        focusRequestId: 0,
      },
    });
    expect(slice().tabs).toHaveLength(2);

    store.openReviewPreview({ runId: 'run-1', path: 'src/other.ts' });
    const refocused = slice().tabs.find((tab) => tab.id === runReview?.id);
    expect(refocused).toMatchObject({
      reviewTarget: {
        scope: 'run',
        runId: 'run-1',
        focusPath: 'src/other.ts',
        focusRequestId: 1,
      },
    });
    expect(slice().tabs).toHaveLength(2);
    expect(slice().activeTabId).toBe(runReview?.id);
  });

  it('migrates saved Review tabs to the task-focused title contract', async () => {
    const migrate = usePageTabStore.persist.getOptions().migrate;
    expect(migrate).toBeDefined();
    if (!migrate) return;

    const migrated = await migrate(
      {
        sessionPreviewByProject: {
          'project-a': {
            open: true,
            activeTabId: 'review-legacy',
            tabs: [
              {
                id: 'review-legacy',
                type: 'review',
                title: 'Review',
                reviewTarget: {
                  scope: 'project',
                  focusRequestId: 0,
                },
                reviewScope: 'all',
              },
            ],
          },
        },
      },
      4
    );
    const restoredReview = (
      migrated as {
        sessionPreviewByProject: Record<
          string,
          { tabs: Array<Record<string, unknown>> }
        >;
      }
    ).sessionPreviewByProject['project-a'].tabs[0];

    expect(usePageTabStore.persist.getOptions().version).toBe(5);
    expect(restoredReview).toMatchObject({
      type: 'review',
      title: 'Task review',
      reviewTarget: { scope: 'project', focusRequestId: 0 },
    });
    expect(restoredReview).not.toHaveProperty('reviewScope');
  });

  it('keeps the first review revision per target and mirrors the tab’s own target', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().activeTabId!;
    store.choosePreviewTabType(chooserId, 'review');
    const tabId = slice().tabs[0].id;
    const first = { baseCommit: 'base-1', targetCommit: 'target-1' };
    const second = { baseCommit: 'base-2', targetCommit: 'target-2' };

    store.setReviewIdentity(tabId, first, 'run:run-1');
    store.setReviewIdentity(tabId, first);

    // A later revision must not move a pin, or nothing is ever out of date.
    store.setReviewIdentity(tabId, second, 'run:run-1');
    store.setReviewIdentity(tabId, second);

    expect(slice().tabs[0]).toMatchObject({
      // The tab's own target is `project`, so only that one mirrors.
      reviewIdentity: first,
      reviewIdentities: { 'run:run-1': first, project: first },
    });
  });

  it('persists Review comments and creates a one-shot Project Chat draft', () => {
    const store = usePageTabStore.getState();
    store.openReviewPreview();
    const review = slice().tabs.find((tab) => tab.type === 'review');
    expect(review).toBeDefined();

    const comments = [
      {
        id: 'comment-1',
        fileId: 'src/app.ts',
        path: 'src/app.ts',
        selection: {
          side: 'modified' as const,
          startLine: 3,
          endLine: 4,
          text: 'const value = 1;',
        },
        body: 'Avoid the magic number.',
        createdAt: 1,
      },
    ];
    store.updateReviewComments(review!.id, comments);

    expect(slice().tabs.find((tab) => tab.id === review!.id)).toMatchObject({
      reviewComments: comments,
    });

    usePageTabStore.getState().requestWorkspaceChatDraft('Review feedback', {
      reviewTabId: review!.id,
      commentIds: ['comment-1'],
    });
    const request = usePageTabStore.getState().workspaceChatDraftRequest;
    expect(request).toMatchObject({
      projectId: 'project-a',
      content: 'Review feedback',
    });
    usePageTabStore.getState().consumeWorkspaceChatDraft(request!.requestId);
    expect(usePageTabStore.getState().workspaceChatDraftRequest).toBeNull();
    expect(usePageTabStore.getState().workspaceReviewHandoffs).toHaveLength(1);
    const handoffId =
      usePageTabStore.getState().workspaceReviewHandoffs[0].handoffId;

    usePageTabStore
      .getState()
      .acknowledgeWorkspaceReviewHandoffs('project-a', ['not-this-handoff']);
    expect(usePageTabStore.getState().workspaceReviewHandoffs).toHaveLength(1);

    usePageTabStore
      .getState()
      .acknowledgeWorkspaceReviewHandoffs('project-a', [handoffId]);
    const sentReview = slice().tabs.find((tab) => tab.id === review!.id);
    expect(sentReview).toMatchObject({
      reviewComments: [
        expect.objectContaining({
          id: 'comment-1',
          status: 'sent',
          sentAt: expect.any(Number),
        }),
      ],
    });
    expect(usePageTabStore.getState().workspaceReviewHandoffs).toEqual([]);
  });

  it('discards an edited-away review handoff without marking comments sent', () => {
    const store = usePageTabStore.getState();
    store.openReviewPreview();
    const review = slice().tabs.find((tab) => tab.type === 'review');
    expect(review).toBeDefined();
    store.updateReviewComments(review!.id, [
      {
        id: 'comment-1',
        fileId: 'src/app.ts',
        path: 'src/app.ts',
        selection: null,
        body: 'Keep this compatible.',
        createdAt: 1,
      },
    ]);
    store.requestWorkspaceChatDraft('Review feedback', {
      reviewTabId: review!.id,
      commentIds: ['comment-1'],
    });
    const handoffId =
      usePageTabStore.getState().workspaceReviewHandoffs[0].handoffId;

    usePageTabStore
      .getState()
      .discardWorkspaceReviewHandoffs('project-a', [handoffId]);

    expect(usePageTabStore.getState().workspaceReviewHandoffs).toEqual([]);
    const pendingReview = slice().tabs.find((tab) => tab.id === review!.id);
    expect(pendingReview).toMatchObject({
      reviewComments: [expect.objectContaining({ id: 'comment-1' })],
    });
    expect(
      pendingReview?.type === 'review'
        ? pendingReview.reviewComments?.[0].status
        : 'wrong-tab-type'
    ).toBeUndefined();
  });

  it('reuses the empty file tab and deduplicates files by path', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;
    store.choosePreviewTabType(chooserId, 'file');

    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);
    store.openFilePreview({ ...file });

    const fileTabs = slice().tabs.filter((tab) => tab.type === 'file');
    expect(fileTabs).toHaveLength(1);
    expect(fileTabs[0]).toMatchObject({ title: 'doc.txt', file });
    expect(slice().activeTabId).toBe(fileTabs[0].id);
  });

  it('deduplicates pathless Artifacts by durable identity', () => {
    const store = usePageTabStore.getState();
    const first = {
      name: 'first.txt',
      type: 'txt',
      path: '',
      artifactId: 'artifact-1',
      localPathAvailable: false,
      assetRef: { chatFileId: 1, key: 'first.txt' },
    } as FileInfo;
    const second = {
      name: 'second.txt',
      type: 'txt',
      path: '',
      artifactId: 'artifact-2',
      localPathAvailable: false,
      assetRef: { chatFileId: 2, key: 'second.txt' },
    } as FileInfo;

    store.openFilePreview(first);
    store.openFilePreview(second);
    store.openFilePreview({ ...first });

    const fileTabs = slice().tabs.filter((tab) => tab.type === 'file');
    expect(fileTabs).toHaveLength(2);
    expect(fileTabs.map((tab) => tab.title)).toEqual([
      'first.txt',
      'second.txt',
    ]);
    expect(slice().activeTabId).toBe(fileTabs[0].id);
  });

  it('refreshes a deduplicated Artifact tab when its preview becomes local', () => {
    const store = usePageTabStore.getState();
    const remote = {
      name: 'index.html',
      type: 'html',
      path: 'https://example.test/signed/index.html',
      relativePath: 'P5/index.html',
      artifactId: 'artifact-html',
      localPathAvailable: false,
      isRemote: true,
      assetRef: { chatFileId: 3, key: 'P5/index.html' },
    } as FileInfo;
    const local = {
      ...remote,
      path: '/workspace/space-1/P5/index.html',
      localPathAvailable: true,
      isRemote: false,
    } as FileInfo;

    store.openFilePreview(remote);
    const originalTab = slice().tabs[0];
    store.openFilePreview(local);

    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0]).toMatchObject({
      id: originalTab.id,
      type: 'file',
      title: 'index.html',
      file: local,
    });
  });

  it('opens chat links in a browser tab of the current project preview', () => {
    const store = usePageTabStore.getState();
    store.openBrowserPreview('https://example.com/docs');

    expect(slice().open).toBe(true);
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0]).toMatchObject({
      type: 'browser',
      url: 'https://example.com/docs',
      title: 'example.com',
    });
    expect(slice().activeTabId).toBe(slice().tabs[0].id);

    // Invalid destinations are ignored.
    store.openBrowserPreview('javascript:alert(1)');
    expect(slice().tabs).toHaveLength(1);
  });

  it('reuses the chooser and deduplicates browser tabs by URL', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.openBrowserPreview('https://example.com/docs');

    // Chooser replaced in place — no extra tab piled up.
    expect(slice().tabs).toHaveLength(1);
    expect(slice().tabs[0].type).toBe('browser');

    // The same URL (modulo trailing slash) focuses the existing tab…
    store.openBrowserPreview('https://example.com/docs/');
    expect(slice().tabs).toHaveLength(1);

    // …while a different URL opens alongside it.
    store.openBrowserPreview('https://other.example.com');
    expect(slice().tabs).toHaveLength(2);
    expect(slice().activeTabId).toBe(slice().tabs[1].id);
  });

  it('selects a neighboring tab and closes the panel after the final tab', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const chooserId = slice().tabs[0].id;
    store.choosePreviewTabType(chooserId, 'browser');
    store.addChooserPreviewTab();
    store.choosePreviewTabType(slice().activeTabId!, 'file');
    const [browserTab, fileTab] = slice().tabs;

    store.closeSessionPreviewTab(browserTab.id);
    expect(slice().activeTabId).toBe(fileTab.id);

    store.closeSessionPreviewTab(fileTab.id);
    expect(slice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });
  });

  it('closes without discarding tabs and resets project-scoped state', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.closeSessionPreview();
    expect(slice().open).toBe(false);
    expect(slice().tabs).toHaveLength(1);

    store.resetSessionPreview();
    expect(slice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });
  });

  it('keeps preview state per project and restores it on switch-back', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const projectATabs = slice().tabs;
    expect(projectATabs).toHaveLength(1);

    // Switching projects swaps in the other project's (empty) slice…
    store.setSessionPreviewProject('project-b');
    expect(slice()).toMatchObject({
      open: false,
      tabs: [],
      activeTabId: null,
    });

    // …and switching back restores tabs, active tab, and the open flag.
    store.setSessionPreviewProject('project-a');
    expect(slice().open).toBe(true);
    expect(slice().tabs).toEqual(projectATabs);
    expect(slice().activeTabId).toBe(projectATabs[0].id);
  });

  it('records mutations into the per-project slice for persistence', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    const file = { name: 'doc.txt', path: '/tmp/doc.txt' } as FileInfo;
    store.openFilePreview(file);

    const persisted =
      usePageTabStore.getState().sessionPreviewByProject['project-a'];
    expect(persisted.open).toBe(true);
    expect(
      persisted.tabs.filter((tab) => tab.type === 'file' && tab.file !== null)
    ).toHaveLength(1);
    expect(persisted.activeTabId).toBe(slice().activeTabId);
  });

  it('disposes shells and drops persisted preview state with a project', () => {
    const store = usePageTabStore.getState();
    store.toggleSessionPreview();
    store.choosePreviewTabType(slice().activeTabId!, 'terminal');
    const terminal = slice().tabs[0];
    expect(terminal.type).toBe('terminal');
    const shellId = terminal.type === 'terminal' ? terminal.shellId : undefined;

    store.setSessionPreviewProject('project-b');
    store.toggleSessionPreview();
    store.removeSessionPreviewProject('project-a');

    expect(window.electronAPI.terminalDispose).toHaveBeenCalledWith(shellId);
    expect(
      usePageTabStore.getState().sessionPreviewByProject['project-a']
    ).toBeUndefined();
    expect(usePageTabStore.getState().sessionPreviewProjectId).toBe(
      'project-b'
    );
    expect(slice().open).toBe(true);
  });
});
