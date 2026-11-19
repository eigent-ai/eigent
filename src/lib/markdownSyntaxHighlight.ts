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
  codeThemeForAppearance,
  registerCodeThemes,
} from '@/lib/codePresentation';
import * as monaco from 'monaco-editor';

function resolveLanguage(language: string): string | null {
  const aliases: Record<string, string> = {
    bash: 'shell',
    csharp: 'csharp',
    cs: 'csharp',
    html: 'html',
    js: 'javascript',
    jsx: 'javascript',
    md: 'markdown',
    py: 'python',
    rb: 'ruby',
    sh: 'shell',
    ts: 'typescript',
    tsx: 'typescript',
    yml: 'yaml',
  };
  const candidate = aliases[language] ?? language;
  const match = monaco.languages
    .getLanguages()
    .find(
      (item) =>
        item.id.toLowerCase() === candidate ||
        item.aliases?.some((alias) => alias.toLowerCase() === candidate)
    );
  return match?.id ?? null;
}

/** Lazily loaded only after a streaming Markdown response becomes stable. */
export async function highlightMarkdownCode(
  source: string,
  requestedLanguage: string,
  appearance: string
): Promise<string | null> {
  const language = resolveLanguage(requestedLanguage);
  if (!language) return null;
  registerCodeThemes(monaco);
  monaco.editor.setTheme(codeThemeForAppearance(appearance));
  return monaco.editor.colorize(source, language, { tabSize: 2 });
}
