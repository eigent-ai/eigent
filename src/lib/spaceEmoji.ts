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

const EMOJI_PATTERN = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const MAX_EMOJI_LENGTH = 32;

/** A Space's chosen emoji, ignoring anything that isn't one. */
export function spaceEmoji(
  space: { metadata?: { emoji?: unknown } | null } | null | undefined
): string | null {
  const emoji = space?.metadata?.emoji;
  return typeof emoji === 'string' &&
    emoji.length <= MAX_EMOJI_LENGTH &&
    EMOJI_PATTERN.test(emoji)
    ? emoji
    : null;
}
