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

import { animate } from 'framer-motion';

/** Default breathing room below the top border of the ChatBox scroll viewport. */
export const CHAT_QUERY_HEADER_GAP_PX = 44;
export const CHAT_QUERY_SCROLL_DURATION_SECONDS = 0.8;
const CHAT_QUERY_SCROLL_EASE = [0.22, 1, 0.36, 1] as const;

export type ChatTimelineScrollAnimation = ReturnType<typeof animate>;

export function getChatTimelineAnchorScrollTop({
  containerTop,
  currentScrollTop,
  targetTop,
  topGapPx = CHAT_QUERY_HEADER_GAP_PX,
}: {
  containerTop: number;
  currentScrollTop: number;
  targetTop: number;
  topGapPx?: number;
}): number {
  return Math.max(
    0,
    currentScrollTop + targetTop - containerTop - Math.max(0, topGapPx)
  );
}

/**
 * Ease a timeline item to the top of its scroll viewport. Framer Motion owns
 * the numeric scroll position so a new request can stop and retarget the same
 * transition without invoking native smooth-scroll or remounting content.
 */
export function animateChatTimelineAnchor(
  container: HTMLElement,
  target: HTMLElement,
  content?: HTMLElement | null,
  onComplete?: () => void
): ChatTimelineScrollAnimation {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const top = getChatTimelineAnchorScrollTop({
    containerTop: containerRect.top,
    currentScrollTop: container.scrollTop,
    targetTop: targetRect.top,
  });

  // A short response may not naturally leave enough scroll range to place its
  // query at the top. Reserve one viewport below the anchor so the requested
  // alignment cannot be clamped by the browser.
  if (content) {
    content.style.minHeight = `${Math.ceil(top + container.clientHeight)}px`;
  }
  return animate(container.scrollTop, top, {
    duration: CHAT_QUERY_SCROLL_DURATION_SECONDS,
    ease: CHAT_QUERY_SCROLL_EASE,
    onUpdate: (value) => {
      container.scrollTop = value;
    },
    onComplete,
  });
}
