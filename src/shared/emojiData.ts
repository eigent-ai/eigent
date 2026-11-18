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
 * The emoji lists the Space emoji picker reads. The build copies them out of
 * the `emojibase-data` package into the app, so the picker works offline.
 * Shared by the build (which copies the files) and the picker (which reads
 * them), so the two cannot drift apart.
 */

/** The package the lists come from. Its version is pinned in package.json. */
export const EMOJI_DATA_PACKAGE = 'emojibase-data';

/** The folder beside index.html that holds one folder per language. */
export const EMOJI_DATA_DIR = 'emojibase';

/** The picker's search languages. An app language without one uses English. */
export const EMOJI_DATA_LOCALES = [
  'en',
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'ru',
  'zh',
  'zh-hant',
] as const;

export type EmojiDataLocale = (typeof EMOJI_DATA_LOCALES)[number];

/** The files the picker reads for each language. */
export const EMOJI_DATA_FILES = ['data.json', 'messages.json'] as const;
