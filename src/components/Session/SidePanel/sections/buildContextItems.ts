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

import type { ReactNode } from 'react';

export type ContextCategory = 'skill' | 'connector' | 'file';

export interface ContextItem {
  id: string;
  label: string;
  icon?: ReactNode;
  iconUrl?: string;
  category: ContextCategory;
  onClick?: () => void;
}

/**
 * Minimal shape this builder needs from a skill record. Mirrors the
 * skillsStore's `Skill` interface but kept local so this module doesn't
 * depend on the Zustand store.
 */
export interface ContextSkill {
  name: string;
  enabled: boolean;
  scope?: { isGlobal?: boolean; selectedAgents?: string[] };
}

/**
 * Connected-provider fields needed to replace raw `MCPToolkit` runtime names
 * with the identity shown in the Open Connectors UI.
 */
export interface ContextConnector {
  service: string;
  displayName?: string;
  iconUrl?: string | null;
  connection?: { connectionName?: string } | null;
  actions?: Array<{ id?: string; name?: string }>;
}

/**
 * Normalize a toolkit/server/skill name for dedup and hint-matching.
 * Lowercases, strips whitespace/underscores/hyphens, and drops a trailing
 * "toolkit" so e.g. "Google Calendar Toolkit", "google_calendar", and
 * "google-calendar" all collapse to the same key.
 */
/** Normalize provider and toolkit names for SidePanel aggregation. */
export function normalizeContextKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+toolkit\s*$/i, '')
    .replace(/[\s_-]+/g, '');
}

function normalizeConnectorIdentity(name: string): string {
  const normalized = normalizeContextKey(name)
    .replace(/toolkit$/i, '')
    .replace(/mcp$/i, '')
    .replace(/connector$/i, '');
  return normalized === 'connectorgateway' ? '' : normalized;
}

/**
 * True only for the Open Connectors gateway itself. Every gateway call is by
 * definition a connected provider, so a lone connector can be assumed. A bare
 * `MCPToolkit` also normalizes to an empty identity but may come from any MCP
 * server configured outside Open Connectors, so it must not be assumed.
 */
function isConnectorGatewayName(name: string): boolean {
  return normalizeContextKey(name) === 'connectorgateway';
}

function connectorAliases(connector: ContextConnector): string[] {
  return Array.from(
    new Set(
      [
        connector.service,
        connector.displayName,
        connector.connection?.connectionName,
      ]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(normalizeConnectorIdentity)
        .filter(Boolean)
    )
  );
}

function connectorMatchScore(
  connector: ContextConnector,
  toolkitKey: string,
  methodKey: string,
  messageKey: string
): number {
  const aliases = connectorAliases(connector);
  let score = 0;

  for (const alias of aliases) {
    if (toolkitKey && toolkitKey === alias) score = Math.max(score, 100);
    if (
      toolkitKey &&
      alias.length >= 3 &&
      (toolkitKey.includes(alias) || alias.includes(toolkitKey))
    ) {
      score = Math.max(score, 90);
    }
    if (alias.length >= 3 && methodKey.includes(alias)) {
      score = Math.max(score, 80);
    }
    if (alias.length >= 4 && messageKey.includes(alias)) {
      score = Math.max(score, 50);
    }
  }

  for (const action of connector.actions ?? []) {
    for (const raw of [action.id, action.name]) {
      if (!raw) continue;
      const actionKey = normalizeContextKey(raw);
      if (!actionKey || !methodKey) continue;
      if (actionKey === methodKey) {
        score = Math.max(score, 70);
      } else if (
        actionKey.length >= 4 &&
        (actionKey.includes(methodKey) || methodKey.includes(actionKey))
      ) {
        score = Math.max(score, 60);
      }
    }
  }

  return score;
}

/**
 * Resolve a runtime MCP call to a connected Open Connector provider. Generic
 * `MCPToolkit` calls are identified by their method/action or request payload.
 * Ambiguous matches deliberately stay generic instead of displaying the wrong
 * provider.
 */
export function resolveContextConnector(
  toolkitName: string,
  method: string,
  message: string,
  connectors: ContextConnector[]
): ContextConnector | null {
  // Normalize the potentially large display detail once per call, rather
  // than once for every configured connector candidate.
  const toolkitKey = normalizeConnectorIdentity(toolkitName);
  const methodKey = normalizeContextKey(method);
  const messageKey = normalizeContextKey(message.slice(0, 2_000));
  const ranked = connectors
    .map((connector) => ({
      connector,
      score: connectorMatchScore(connector, toolkitKey, methodKey, messageKey),
    }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && best.score > 0 && best.score > (ranked[1]?.score ?? 0)) {
    return best.connector;
  }

  return isConnectorGatewayName(toolkitName) && connectors.length === 1
    ? connectors[0]!
    : null;
}

/**
 * Pull skill name(s) out of a `SkillToolkit.load_skill(...)` args string.
 *
 * Two emission paths produce two formats:
 *   1. **Agent path** (`listen_chat_agent._aexecute_tool` /
 *      `_execute_tool`) emits `message = json.dumps(args)`, e.g.
 *      `{"name":"pdf"}` or `{"name":["pdf","foo"]}`. This is what
 *      SkillToolkit currently goes through because its `load_skill` /
 *      `list_skills` methods aren't `@listen_toolkit`-decorated.
 *   2. **`@listen_toolkit` path** (other toolkits) emits Python `repr`
 *      formatted args, e.g. `'pdf'` or `name='pdf'` or `['pdf','foo']`.
 *      Kept as a fallback in case SkillToolkit ever gets decorated.
 *
 * Once the tool deactivates, chatStore concatenates the activate args and
 * the deactivate result with a `\n`, so the args are on the first line and
 * the rest of `message` is the skill body. Backend may also append a
 * "(truncated, …)" tail at 500 chars — we strip it.
 */
export function extractLoadedSkillNames(message: string): string[] {
  if (!message) return [];

  // Args (if present) sit on the first line — the deactivate result is
  // appended after a newline. Try the head first, then fall back to the
  // whole string if the head doesn't yield anything.
  const head = message.split(/\r?\n/)[0] ?? '';
  const candidates =
    head.trim() && head.trim() !== message.trim() ? [head, message] : [message];

  for (const candidate of candidates) {
    const cleaned = candidate
      .replace(/\.\.\.\s*\(truncated[^)]*\)\s*$/i, '')
      .trim();
    if (!cleaned) continue;

    // 1. JSON args from the agent path.
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && 'name' in parsed) {
        const name = (parsed as { name: unknown }).name;
        if (Array.isArray(name)) {
          const items = name
            .filter((n): n is string => typeof n === 'string')
            .map((n) => n.trim())
            .filter(Boolean);
          if (items.length) return items;
        } else if (typeof name === 'string' && name.trim()) {
          return [name.trim()];
        }
      }
    } catch {
      // Not JSON — fall through to repr parsing.
    }

    // 2. Python-repr fallback (`@listen_toolkit` formatting).
    const noKw = cleaned.replace(/^\s*name\s*=\s*/i, '').trim();
    if (noKw.startsWith('[')) {
      const items: string[] = [];
      const re = /['"]([^'"]+?)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(noKw)) !== null) {
        const v = m[1].trim();
        if (v) items.push(v);
      }
      if (items.length) return items;
    }
    const quoted = noKw.match(/^['"]([^'"]+?)['"]/);
    if (quoted) return [quoted[1].trim()];
  }

  return [];
}
