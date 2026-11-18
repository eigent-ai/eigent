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
  CHAT_MIN_WIDTH,
  clampChatSideWidth,
  getSessionColumnLayout,
  PREVIEW_PANE_MIN_WIDTH,
  SUMMARY_DOCK_MIN_WIDTH,
} from '@/components/Session/layout/sessionColumns';
import { describe, expect, it } from 'vitest';

const base = {
  paneWidth: 1400,
  fallbackPaneWidth: 1200,
  previewOpen: false,
  summaryOpen: false,
  chatSideWidth: null,
};

describe('getSessionColumnLayout', () => {
  it('docks Summary in a wide pane without Preview', () => {
    expect(getSessionColumnLayout(base)).toMatchObject({
      showPreview: false,
      canDockSummary: true,
    });
    expect(
      getSessionColumnLayout({
        ...base,
        paneWidth: SUMMARY_DOCK_MIN_WIDTH - 1,
      }).canDockSummary
    ).toBe(false);
  });

  it('closes Preview only below both minimums plus its border', () => {
    expect(PREVIEW_PANE_MIN_WIDTH).toBe(681);
    const open = { ...base, previewOpen: true };
    expect(
      getSessionColumnLayout({ ...open, paneWidth: 681 }).showPreview
    ).toBe(true);
    expect(
      getSessionColumnLayout({ ...open, paneWidth: 680 }).showPreview
    ).toBe(false);
    // Before measurement Preview stays open on the saved preference.
    expect(
      getSessionColumnLayout({ ...open, paneWidth: null }).showPreview
    ).toBe(true);
  });

  it('sizes the chat side for Summary on first open and clamps to Preview room', () => {
    const layout = getSessionColumnLayout({
      ...base,
      previewOpen: true,
      summaryOpen: true,
    });
    expect(layout.visibleChatSideWidth).toBe(SUMMARY_DOCK_MIN_WIDTH);
    expect(layout.canDockSummary).toBe(true);

    const clamped = getSessionColumnLayout({
      ...base,
      previewOpen: true,
      chatSideWidth: 5000,
    });
    expect(clamped.maxChatSideWidth).toBe(1400 - 320 - 1);
    expect(clamped.visibleChatSideWidth).toBe(clamped.maxChatSideWidth);
  });

  it('undocks Summary when Preview leaves the chat side too narrow', () => {
    expect(
      getSessionColumnLayout({
        ...base,
        previewOpen: true,
        summaryOpen: true,
        chatSideWidth: SUMMARY_DOCK_MIN_WIDTH - 1,
      }).canDockSummary
    ).toBe(false);
  });
});

describe('clampChatSideWidth', () => {
  it('keeps the chat minimum and the maximum', () => {
    expect(clampChatSideWidth(100, 900)).toBe(CHAT_MIN_WIDTH);
    expect(clampChatSideWidth(1000, 900)).toBe(900);
    expect(clampChatSideWidth(500, 900)).toBe(500);
  });
});
