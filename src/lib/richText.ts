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

/** Shared by `RichChatInput` and `UserMessageRichContent` (URLs, #skills, @connectors). */
export type RichSegment = {
  type: 'text' | 'url' | 'skill' | 'connector';
  text: string;
};

/** Chip styling shared by the input HTML and the message-body renderer. */
export const RICH_CONNECTOR_STYLE_CLASSES =
  'text-ds-text-information-default-default bg-ds-bg-neutral-default-default';

/** `@token` inserted into the input for a connector; spaces collapse to `_`. */
export function connectorNameToToken(name: string): string {
  const slug = name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_-]/g, '');
  return `@${slug || 'connector'}`;
}

/** Hash-stable palette: semantic “other” tones (not default body text). Shared by input + message body. */
export const RICH_SKILL_STYLE_CLASSES = [
  'text-ds-text-success-default-default bg-ds-bg-neutral-default-default',
  'text-ds-text-warning-default-default bg-ds-bg-neutral-default-default',
  'text-ds-text-terminal-default-default bg-ds-bg-neutral-default-default',
  'text-ds-text-document-default-default bg-ds-bg-neutral-default-default',
] as const;

export function hashSkillLabel(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h << 5) - h + label.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Strip trailing punctuation often typed after pasted URLs. */
export function trimUrlTail(raw: string): string {
  return raw.replace(/[`'".,;:!?)\]]+$/g, '');
}

const URL_AT_START = /^(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i;
const SKILL_AT_START = /^#([a-zA-Z0-9_-]+)/;
const CONNECTOR_AT_START = /^@([A-Za-z0-9_-]+)/;

/** True when `@` here begins a connector token rather than an email tail (`me@host`). */
function isConnectorStart(text: string, at: number): boolean {
  const prev = text[at - 1];
  if (prev && /[A-Za-z0-9_]/.test(prev)) return false;
  return CONNECTOR_AT_START.test(text.slice(at));
}

/** Plain-text tokenizer: URLs, #skill tokens, and @connector tokens. */
export function tokenizeRichPlainText(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const slice = text.slice(i);
    const urlMatch = slice.match(URL_AT_START);
    if (urlMatch) {
      const full = urlMatch[0];
      const trimmed = trimUrlTail(full);
      if (trimmed.length > 0) {
        out.push({ type: 'url', text: trimmed });
        if (full.length > trimmed.length) {
          out.push({ type: 'text', text: full.slice(trimmed.length) });
        }
        i += full.length;
        continue;
      }
    }

    if (slice[0] === '#') {
      const skillMatch = slice.match(SKILL_AT_START);
      if (skillMatch) {
        out.push({ type: 'skill', text: skillMatch[0] });
        i += skillMatch[0].length;
        continue;
      }
    }

    if (slice[0] === '@' && isConnectorStart(text, i)) {
      const connMatch = slice.match(CONNECTOR_AT_START);
      if (connMatch) {
        out.push({ type: 'connector', text: connMatch[0] });
        i += connMatch[0].length;
        continue;
      }
    }

    let j = i + 1;
    while (j < len) {
      const tail = text.slice(j);
      if (URL_AT_START.test(tail)) break;
      if (text[j] === '#' && SKILL_AT_START.test(tail)) break;
      if (text[j] === '@' && isConnectorStart(text, j)) break;
      j++;
    }
    out.push({ type: 'text', text: text.slice(i, j) });
    i = j;
  }

  return out;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function httpUrlOrNull(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (/^www\./i.test(trimmed)) {
      return `https://${trimmed}`;
    }
    return null;
  }
}

export function segmentsToHtml(segments: RichSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.type === 'text') {
      parts.push(escapeHtml(seg.text).replace(/\n/g, '<br />'));
    } else if (seg.type === 'url') {
      const href = httpUrlOrNull(seg.text);
      const safe = escapeHtml(seg.text);
      if (href) {
        parts.push(
          `<a href="${escapeHtml(href)}" data-rich-url="1" class="text-ds-text-information-default-default underline underline-offset-2 decoration-ds-border-information-default-default">${safe}</a>`
        );
      } else {
        parts.push(safe);
      }
    } else if (seg.type === 'connector') {
      parts.push(
        `<span data-rich-connector="1" contenteditable="false" class="rounded px-0.5 py-px font-medium ${RICH_CONNECTOR_STYLE_CLASSES}">${escapeHtml(
          seg.text
        )}</span>`
      );
    } else {
      const idx = hashSkillLabel(seg.text) % RICH_SKILL_STYLE_CLASSES.length;
      const cls = RICH_SKILL_STYLE_CLASSES[idx];
      parts.push(
        `<span data-rich-skill="1" contenteditable="false" class="rounded px-0.5 py-px font-medium ${cls}">${escapeHtml(seg.text)}</span>`
      );
    }
  }
  return parts.join('');
}

/** Skill name from `{{...}}` tags — safe for IPC when it matches this pattern. */
export const SAFE_SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isSafeSkillFolderName(name: string): boolean {
  return SAFE_SKILL_NAME_PATTERN.test(name);
}
