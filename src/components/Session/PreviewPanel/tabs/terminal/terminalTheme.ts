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
 * Fixed dark palette shared by both terminal surfaces (interactive shell and
 * read-only agent stream). The screen stays dark in both app themes (terminal
 * convention), and xterm paints with concrete colors — CSS variables from the
 * design-token engine can't be used here.
 */
export const TERMINAL_SCREEN_BACKGROUND = '#18181b';

export const TERMINAL_BASE_THEME = {
  background: TERMINAL_SCREEN_BACKGROUND,
  foreground: '#d4d4d8',
  selectionBackground: '#3f3f46',
};

/**
 * Same code stack as markdown code blocks (`.markdown-body code` in
 * markdown-styles.css): the system default code font (`ui-monospace`) first,
 * then explicit fallbacks per platform. Must stay in sync with
 * `previewTerminal.css`: xterm measures character cells with this family, and
 * the CSS pins the rendered glyphs to the same one (the app's global
 * `* { font-family: 'Inter' }` rule would otherwise repaint them
 * proportionally).
 */
export const TERMINAL_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
export const TERMINAL_FONT_SIZE = 12;
export const TERMINAL_LINE_HEIGHT = 1.2;
