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
 * Clean-up applied to every value of a Shared Session before it leaves the
 * device. It errs on the side of removing too much: a removed value shows as
 * {@link REMOVED}, which the preview makes visible to the owner.
 */

export const REMOVED = '[removed]';

/** Object keys whose values are credentials, whatever their shape. */
const SECRET_KEY =
  /^(?:.*[_-])?(?:api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd|pwd|passphrase|authorization|cookie|set[_-]?cookie|credentials?|private[_-]?key|signature)$/i;

/** Object keys that hold environment variables: names stay, values go. */
const ENV_KEY =
  /^(?:env|envs|environ|environment|env_vars|environment_variables|envVars|environmentVariables)$/i;

/** Model reasoning fields, left out unless the owner includes thinking. */
const THINKING_KEY =
  /^(?:thinking|thinking_summary|thinkingSummary|reasoning|reasoning_content|reasoningContent|reasoning_summary|reasoningSummary)$/i;

/** Credential shapes that can appear inside free text or tool output. */
const SECRET_VALUE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    REMOVED,
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, `Bearer ${REMOVED}`],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REMOVED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REMOVED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REMOVED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REMOVED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REMOVED],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, REMOVED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, REMOVED],
  // ?api_key=…, &token=… in URLs.
  [
    /([?&](?:api[_-]?key|access[_-]?token|token|key|secret|signature|sig|password|auth)=)[^&\s"'#]+/gi,
    `$1${REMOVED}`,
  ],
  // OPENAI_API_KEY=…, export GITHUB_TOKEN="…" in commands and logs.
  [
    /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)(\s*=\s*)("[^"]*"|'[^']*'|[^\s"']+)/g,
    `$1$2${REMOVED}`,
  ],
  // "api_key": "…" inside JSON text that was kept as a string.
  [
    /("[A-Za-z0-9_-]*(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*)"[^"]*"/gi,
    `$1"${REMOVED}"`,
  ],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The ways one absolute path can be spelled inside text. */
function pathSpellings(root: string): string[] {
  const trimmed = root.replace(/[\\/]+$/, '');
  if (!trimmed) return [];
  const forward = trimmed.replace(/\\/g, '/');
  const back = trimmed.replace(/\//g, '\\');
  // JSON text written into a string doubles every backslash.
  const doubled = back.replace(/\\/g, '\\\\');
  return [...new Set([trimmed, forward, back, doubled])].sort(
    (a, b) => b.length - a.length
  );
}

/** Home folders name the person; replace them with `~`. */
const HOME_PATTERNS: readonly RegExp[] = [
  /(^|[^\w.~-])\/(?:Users|home)\/[^/\\\s"'`<>|]+/g,
  /\b[A-Za-z]:(?:\\\\|\\|\/)(?:Users|Documents and Settings)(?:\\\\|\\|\/)[^/\\\s"'`<>|]+/gi,
];

export interface CleanContext {
  /** The Session's Space folder; paths inside it become relative. */
  spaceRoot: string | null;
  includeThinking: boolean;
}

export interface PreparedCleanContext extends CleanContext {
  rootPatterns: RegExp[];
}

export function prepareCleanContext(
  context: CleanContext
): PreparedCleanContext {
  const rootPatterns = context.spaceRoot
    ? pathSpellings(context.spaceRoot).map(
        (spelling) =>
          // The root followed by a separator becomes relative; the root on
          // its own becomes ".". Windows paths are case-insensitive.
          new RegExp(
            `${escapeRegExp(spelling)}(?:\\\\\\\\|\\\\|/)?`,
            /^[A-Za-z]:/.test(spelling) ? 'gi' : 'g'
          )
      )
    : [];
  return { ...context, rootPatterns };
}

export function cleanSharedString(
  value: string,
  context: PreparedCleanContext
): string {
  let text = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  for (const pattern of context.rootPatterns) {
    text = text.replace(pattern, (match, offset: number, whole: string) => {
      const endsWithSeparator = /[\\/]$/.test(match);
      if (endsWithSeparator) return '';
      // A bare root followed by more name characters is a different folder
      // (e.g. "/work/space" inside "/work/space-old"); leave it for the home
      // rule.
      const next = whole[offset + match.length];
      return next && /[\w.-]/.test(next) ? match : '.';
    });
  }
  text = text.replace(HOME_PATTERNS[0], '$1~');
  text = text.replace(HOME_PATTERNS[1], '~');
  return text;
}

/**
 * Deep-clean a JSON value. Object keys are sorted so the same input always
 * gives byte-identical output.
 */
export function cleanSharedValue(
  value: unknown,
  context: PreparedCleanContext
): unknown {
  if (typeof value === 'string') return cleanSharedString(value, context);
  if (Array.isArray(value)) {
    return value.map((item) => cleanSharedValue(item, context));
  }
  if (!value || typeof value !== 'object') return value;

  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) continue;
    if (THINKING_KEY.test(key) && !context.includeThinking) continue;
    if (SECRET_KEY.test(key)) {
      cleaned[key] =
        child === null || child === '' || typeof child === 'boolean'
          ? child
          : REMOVED;
      continue;
    }
    if (ENV_KEY.test(key) && child && typeof child === 'object') {
      cleaned[key] = Array.isArray(child)
        ? child.map(() => REMOVED)
        : Object.fromEntries(
            Object.keys(child)
              .sort()
              .map((name) => [name, REMOVED])
          );
      continue;
    }
    cleaned[key] = cleanSharedValue(child, context);
  }
  return cleaned;
}
