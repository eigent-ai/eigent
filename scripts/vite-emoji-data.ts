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

import { createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  EMOJI_DATA_DIR,
  EMOJI_DATA_FILES,
  EMOJI_DATA_LOCALES,
  EMOJI_DATA_PACKAGE,
} from '../src/shared/emojiData';

export interface EmojiDataFile {
  /** Path in the built app and on the dev server, such as emojibase/en/data.json. */
  fileName: string;
  /** The file to copy, inside the installed emoji data package. */
  source: string;
}

/** Every emoji list file the app ships, for the languages the picker uses. */
export function emojiDataFiles(packageDir: string): EmojiDataFile[] {
  return EMOJI_DATA_LOCALES.flatMap((locale) =>
    EMOJI_DATA_FILES.map((file) => ({
      fileName: `${EMOJI_DATA_DIR}/${locale}/${file}`,
      source: path.join(packageDir, locale, file),
    }))
  );
}

/**
 * Ship the emoji picker's lists with the app instead of fetching them from a
 * CDN: the dev server serves them, and a build copies them next to index.html.
 * Only the picker's languages are copied, about 8 MB of the 50 MB package.
 */
export function emojiData(rootDir: string): Plugin {
  const packageDir = path.join(rootDir, 'node_modules', EMOJI_DATA_PACKAGE);
  const files = emojiDataFiles(packageDir);
  const sourceByUrl = new Map(
    files.map((file) => [`/${file.fileName}`, file.source])
  );

  let isBuild = false;

  return {
    name: 'eigent-emoji-data',
    configResolved(config) {
      isBuild = config.command === 'build';
    },
    buildStart() {
      const missing = files.find((file) => !existsSync(file.source));
      if (!missing) return;
      const message = `Emoji list not found: ${missing.source}. Run npm install to add ${EMOJI_DATA_PACKAGE}.`;
      // A build without the lists would ship a picker that needs the network.
      if (isBuild) this.error(message);
      this.warn(message);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = sourceByUrl.get((request.url ?? '').split('?')[0]);
        if (!source || !existsSync(source)) {
          next();
          return;
        }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        createReadStream(source).pipe(response);
      });
    },
    generateBundle() {
      for (const file of files) {
        this.emitFile({
          type: 'asset',
          fileName: file.fileName,
          source: readFileSync(file.source),
        });
      }
    },
  };
}
