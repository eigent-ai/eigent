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

/**
 * The two chat timeline modes.
 *
 * `narrative` answers “what did it do for me” with the agent's own words;
 * `trajectory` answers “what exactly happened” with the full event trace.
 * Only the work band differs between them — the user query, plan, interrupts,
 * artifacts, and final response render identically in both.
 */
export const chatTimelineDetailLevels = ['narrative', 'trajectory'] as const;

export type ChatTimelineDetailLevel = (typeof chatTimelineDetailLevels)[number];

/** Product default. Never actively wrong for either audience. */
export const DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL: ChatTimelineDetailLevel =
  'narrative';

/** Retired mode keys still present in persisted tab state. */
const RETIRED_DETAIL_LEVELS: Readonly<Record<string, ChatTimelineDetailLevel>> =
  Object.freeze({
    compact: 'narrative',
    normal: 'narrative',
    summarized: 'narrative',
    detailed: 'trajectory',
  });

/**
 * Resolve any persisted or user-supplied value to a supported mode. Unknown
 * values fall back to the product default rather than leaving the timeline
 * without a renderer.
 */
export function normalizeChatTimelineDetailLevel(
  value: unknown
): ChatTimelineDetailLevel {
  if (typeof value !== 'string') return DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL;
  if ((chatTimelineDetailLevels as readonly string[]).includes(value)) {
    return value as ChatTimelineDetailLevel;
  }
  return RETIRED_DETAIL_LEVELS[value] ?? DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL;
}
