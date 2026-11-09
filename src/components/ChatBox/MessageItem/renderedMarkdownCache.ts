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

/** Finished messages, so reopening a Session doesn't parse them all again. */
const MAX_ENTRY_CHARS = 100_000;
const MAX_TOTAL_CHARS = 4_000_000;

const entries = new Map<string, string>();
let totalChars = 0;

const entryChars = (key: string, html: string) => key.length + html.length;

function remove(key: string) {
  const html = entries.get(key);
  if (html === undefined) return;
  entries.delete(key);
  totalChars -= entryChars(key, html);
}

export function renderedMarkdownKey(
  content: string,
  profile: string,
  labels: Record<string, string>,
  contentBasePath?: string | null
): string {
  return JSON.stringify([profile, labels, contentBasePath ?? '', content]);
}

export function readRenderedMarkdown(key: string): string | undefined {
  const html = entries.get(key);
  if (html !== undefined) {
    // Most recently read goes last, so the oldest is first to leave.
    entries.delete(key);
    entries.set(key, html);
  }
  return html;
}

export function saveRenderedMarkdown(key: string, html: string): void {
  remove(key);
  if (entryChars(key, html) > MAX_ENTRY_CHARS) return;
  entries.set(key, html);
  totalChars += entryChars(key, html);
  for (const oldest of entries.keys()) {
    if (totalChars <= MAX_TOTAL_CHARS) break;
    remove(oldest);
  }
}

/** Characters held, for tests. */
export function renderedMarkdownCacheChars(): number {
  return totalChars;
}

export function clearRenderedMarkdownCache(): void {
  entries.clear();
  totalChars = 0;
}
