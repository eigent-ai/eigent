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
  animateChatTimelineAnchor,
  CHAT_QUERY_HEADER_GAP_PX,
  CHAT_QUERY_SCROLL_DURATION_SECONDS,
  getChatTimelineAnchorScrollTop,
  isChatTimelineNearBottom,
} from '@/components/ChatBox/chatTimelineScroll';
import { animate } from 'framer-motion';
import { describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  animate: vi.fn(
    (
      _from: number,
      to: number,
      options: { onComplete?: () => void; onUpdate: (value: number) => void }
    ) => {
      options.onUpdate(to);
      options.onComplete?.();
      return { stop: vi.fn() };
    }
  ),
}));

describe('chat timeline query anchoring', () => {
  it('places the query flush with the viewport top by default', () => {
    expect(CHAT_QUERY_HEADER_GAP_PX).toBe(0);
    expect(
      getChatTimelineAnchorScrollTop({
        containerTop: 44,
        currentScrollTop: 500,
        targetTop: 164,
      })
    ).toBe(620);
  });

  it('leaves an explicit gap above the query when one is requested', () => {
    expect(
      getChatTimelineAnchorScrollTop({
        containerTop: 44,
        currentScrollTop: 500,
        targetTop: 164,
        topGapPx: 44,
      })
    ).toBe(576);
  });

  it('never requests a negative scroll position', () => {
    expect(
      getChatTimelineAnchorScrollTop({
        containerTop: 44,
        currentScrollTop: 0,
        targetTop: 20,
      })
    ).toBe(0);
  });

  it('reserves enough content height for short replies to keep the alignment', () => {
    const container = document.createElement('div');
    const target = document.createElement('div');
    const content = document.createElement('div');
    Object.defineProperties(container, {
      clientHeight: { value: 400 },
      scrollTop: { value: 500, writable: true },
    });
    container.getBoundingClientRect = vi.fn(() => ({ top: 44 }) as DOMRect);
    target.getBoundingClientRect = vi.fn(() => ({ top: 164 }) as DOMRect);
    container.scrollTo = vi.fn();

    animateChatTimelineAnchor(container, target, content);

    expect(content.style.minHeight).toBe('1020px');
    expect(container.scrollTop).toBe(620);
    expect(animate).toHaveBeenCalledWith(
      500,
      620,
      expect.objectContaining({
        duration: CHAT_QUERY_SCROLL_DURATION_SECONDS,
        onUpdate: expect.any(Function),
      })
    );
  });
});

describe('isChatTimelineNearBottom', () => {
  it('treats the composer inset as still pinned, not a 120px padding zone', () => {
    expect(isChatTimelineNearBottom(150, 200)).toBe(true);
    expect(isChatTimelineNearBottom(120, 128)).toBe(true);
    expect(isChatTimelineNearBottom(400, 200)).toBe(false);
  });
});
