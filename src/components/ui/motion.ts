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

const UI_EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];

const ITEM_FADE_TRANSITION = {
  duration: 0.16,
  ease: UI_EASE_OUT,
} as const;

const REDUCED_ITEM_FADE_TRANSITION = {
  duration: 0.12,
  ease: UI_EASE_OUT,
} as const;

/**
 * Opacity-only lifecycle motion for frequently updated operational lists.
 * It remains brief and interruptible and keeps reduced motion free of travel.
 */
export function itemFadeMotion(reducedMotion: boolean) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: reducedMotion
      ? REDUCED_ITEM_FADE_TRANSITION
      : ITEM_FADE_TRANSITION,
  } as const;
}
