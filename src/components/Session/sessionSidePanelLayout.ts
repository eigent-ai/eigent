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

/** Full logical width of the session side panel content (clipped by the outer when folded to 40px). */
export const SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS =
  'w-[min(360px,40vw)] max-w-[400px]';

/** Outer `#session-side-panel` when expanded (same as content width; no extra clip). */
export const SESSION_SIDE_PANEL_EXPANDED_OUTER_CLASS =
  SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS;

/** Outer shell when folded: fixed 40px; content layer keeps `SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS`. */
export const SESSION_SIDE_PANEL_FOLDED_OUTER_CLASS = 'w-[40px]';
