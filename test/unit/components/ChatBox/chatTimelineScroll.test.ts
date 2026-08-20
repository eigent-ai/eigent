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
  it('places the query below the viewport top with the default 44px gap', () => {
    expect(CHAT_QUERY_HEADER_GAP_PX).toBe(44);
    expect(
      getChatTimelineAnchorScrollTop({
        containerTop: 44,
        currentScrollTop: 500,
        targetTop: 164,
      })
    ).toBe(576);
  });

  it('never requests a negative scroll position', () => {
    expect(
      getChatTimelineAnchorScrollTop({
        containerTop: 44,
        currentScrollTop: 0,
        targetTop: 50,
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

    expect(content.style.minHeight).toBe('976px');
    expect(container.scrollTop).toBe(576);
    expect(animate).toHaveBeenCalledWith(
      500,
      576,
      expect.objectContaining({
        duration: CHAT_QUERY_SCROLL_DURATION_SECONDS,
        onUpdate: expect.any(Function),
      })
    );
  });
});
