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

import { FileText, Hammer, WandSparkles } from 'lucide-react';
import { createElement } from 'react';
import type { ContextItem } from './ExecutionContextSection';

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
 * Normalize a toolkit/server/skill name for dedup and hint-matching.
 * Lowercases, strips whitespace/underscores/hyphens, and drops a trailing
 * "toolkit" so e.g. "Google Calendar Toolkit", "google_calendar", and
 * "google-calendar" all collapse to the same key.
 */
function normalizeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+toolkit\s*$/i, '')
    .replace(/[\s_-]+/g, '');
}

function categoryFromCategoryName(
  categoryName: string | undefined
): 'skill' | 'connector' {
  return (categoryName ?? '').toLowerCase() === 'skill' ? 'skill' : 'connector';
}

const SKILL_TOOLKIT_NAME = 'SkillToolkit';
/**
 * Method names show up in two flavors depending on which path emitted the
 * event: `@listen_toolkit` rewrites `_` → ` ` ("load skill"), while the
 * agent's untracked-tool path passes the raw Python identifier
 * ("load_skill"). We normalize before comparing so both flavors match.
 */
const SKILL_LOAD_METHOD = 'load skill';
const SKILL_LIST_METHOD = 'list skills';

function normalizeMethodName(method: string): string {
  return method.trim().toLowerCase().replace(/_/g, ' ');
}

/**
 * Substring (not word-boundary) checks: backend toolkit class names like
 * `SkillToolkit` and `XxxMCPToolkit` don't have a word boundary after
 * "skill"/"mcp", so a `\bskill\b` / `\bmcp\b` regex would silently miss them.
 */
function isSkillToolkitName(name: string): boolean {
  return /skill/i.test(name);
}

function isMcpToolkitName(name: string): boolean {
  return /mcp/i.test(name);
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
function extractLoadedSkillNames(message: string): string[] {
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

type RuntimeToolkit = {
  toolkitName: string;
  method: string;
  message: string;
};

function forEachRuntimeToolkit(
  agents: Agent[],
  taskRunning: TaskInfo[] | undefined,
  fn: (tk: RuntimeToolkit) => void
) {
  for (const agent of agents) {
    for (const task of agent.tasks ?? []) {
      for (const tk of task.toolkits ?? []) {
        const name = tk.toolkitName;
        if (!name || name === 'notice') continue;
        fn({
          toolkitName: name,
          method: tk.toolkitMethods ?? '',
          message: tk.message ?? '',
        });
      }
    }
  }
  for (const task of taskRunning ?? []) {
    for (const tk of task.toolkits ?? []) {
      const name = tk.toolkitName;
      if (!name || name === 'notice') continue;
      fn({
        toolkitName: name,
        method: tk.toolkitMethods ?? '',
        message: tk.message ?? '',
      });
    }
  }
}

/**
 * Collect classification hints from per-agent `workerInfo` and the skills
 * store. These are used **only** to bucket runtime toolkit names into
 * skill vs connector — configured items are not surfaced until they
 * actually fire at runtime, so the panel stays scoped to "what was used in
 * this task".
 */
function collectHints(agents: Agent[], skills: ContextSkill[]) {
  const skillHints = new Set<string>();
  const connectorHints = new Set<string>();

  const add = (set: Set<string>, raw: string) => {
    const k = normalizeKey(raw);
    if (k) set.add(k);
  };

  for (const agent of agents) {
    const info = agent.workerInfo;
    if (!info) continue;

    const mcp: unknown = info.mcp_tools;
    if (mcp && typeof mcp === 'object') {
      const servers = (mcp as { mcpServers?: Record<string, unknown> })
        .mcpServers;
      if (servers && typeof servers === 'object') {
        for (const name of Object.keys(servers)) add(connectorHints, name);
      }
    }

    const selected: unknown = info.selectedTools;
    if (Array.isArray(selected)) {
      for (const raw of selected) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as {
          name?: string;
          key?: string;
          toolkit?: string;
          category?: { name?: string };
        };
        const label = item.name ?? item.key ?? item.toolkit;
        if (!label) continue;
        const cat = categoryFromCategoryName(item.category?.name);
        const set = cat === 'skill' ? skillHints : connectorHints;
        add(set, label);
        if (item.toolkit) add(set, item.toolkit);
      }
    }
  }

  for (const skill of skills) {
    if (!skill.enabled) continue;
    add(skillHints, skill.name);
  }

  return { skillHints, connectorHints };
}

/**
 * Derive a flat, deduplicated list of context items (skills / MCP tools /
 * referenced files) for the **active task**. Only items the task has
 * actually used at runtime appear here — configured-but-unused skills and
 * MCP servers are intentionally hidden so the panel reflects work in
 * flight, not the user's library.
 *
 * Sources:
 *   1. Runtime toolkit usage from `task.toolkits` /
 *      `taskRunning[].toolkits` (ACTIVATE_TOOLKIT). For `SkillToolkit` the
 *      *method* is the skill name and is surfaced one row per skill;
 *      everything else surfaces by toolkit name. Classification falls
 *      back to substring tests against the toolkit name itself, so
 *      `SkillToolkit` / `XxxMCPToolkit` always classify even with no
 *      hints.
 *   2. Uploaded files referenced on user messages.
 *
 * The `skills` and `workerInfo` data are read **only** to seed
 * classification hints for ambiguous toolkit names — they never produce
 * standalone rows.
 */
export function buildContextItems(
  agents: Agent[],
  taskRunning?: TaskInfo[],
  uploadedFiles: File[] = [],
  skills: ContextSkill[] = []
): ContextItem[] {
  const seen = new Set<string>();
  const out: ContextItem[] = [];

  const push = (item: ContextItem) => {
    const key = `${item.category}:${normalizeKey(item.id)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const { skillHints, connectorHints } = collectHints(agents, skills);

  forEachRuntimeToolkit(
    agents,
    taskRunning,
    ({ toolkitName, method, message }) => {
      // SkillToolkit only exposes two methods to the agent: `list_skills`
      // and `load_skill(name)`. The skill the user actually invoked is the
      // *argument* to `load_skill`, never the method name. So we ignore
      // `list skills` (it's just enumeration) and parse the args of
      // `load skill` to surface one row per loaded skill.
      if (toolkitName === SKILL_TOOLKIT_NAME) {
        const m = normalizeMethodName(method);
        if (m === SKILL_LIST_METHOD) return;
        if (m === SKILL_LOAD_METHOD) {
          for (const skillName of extractLoadedSkillNames(message)) {
            push({
              id: `skill:${skillName}`,
              label: skillName,
              category: 'skill',
              icon: createElement(WandSparkles, { size: 16 }),
            });
          }
          return;
        }
        // Unknown method on SkillToolkit — never surface the umbrella row.
        // If a real skill was invoked we'd have hit the `load_skill` branch
        // above; falling through here would just re-display "SkillToolkit".
        return;
      }

      const norm = normalizeKey(toolkitName);
      let category: ContextItem['category'] | null = null;
      if (skillHints.has(norm) || isSkillToolkitName(toolkitName)) {
        category = 'skill';
      } else if (connectorHints.has(norm) || isMcpToolkitName(toolkitName)) {
        category = 'connector';
      }
      if (!category) return;

      push({
        id: toolkitName,
        label: toolkitName,
        category,
        icon:
          category === 'skill'
            ? createElement(WandSparkles, { size: 16 })
            : createElement(Hammer, { size: 16 }),
      });
    }
  );

  for (const file of uploadedFiles) {
    const filePath = file.filePath?.trim();
    if (!filePath) continue;
    const fallbackName = filePath.split('/').pop() || filePath;
    const label = file.fileName?.trim() || fallbackName;
    push({
      id: filePath,
      label,
      category: 'file',
      icon: createElement(FileText, { size: 16 }),
    });
  }

  return out;
}
