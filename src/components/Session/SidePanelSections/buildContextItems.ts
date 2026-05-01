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

import { getToolkitIcon } from '@/lib/toolkitIcons';
import { FileText } from 'lucide-react';
import { createElement } from 'react';
import type { ContextItem } from './ExecutionContextSection';

function addHint(set: Set<string>, raw: string) {
  const t = raw.trim().toLowerCase();
  if (!t) return;
  set.add(t);
  const noToolkit = t.replace(/\s+toolkit\s*$/i, '').trim();
  if (noToolkit && noToolkit !== t) set.add(noToolkit);
}

function collectWorkerHintSets(agents: Agent[]) {
  const skillHints = new Set<string>();
  const connectorHints = new Set<string>();

  for (const agent of agents) {
    const info = agent.workerInfo;
    if (!info) continue;

    const mcp: unknown = info.mcp_tools;
    if (mcp && typeof mcp === 'object') {
      const servers = (mcp as { mcpServers?: Record<string, unknown> })
        .mcpServers;
      if (servers && typeof servers === 'object') {
        for (const name of Object.keys(servers)) {
          addHint(connectorHints, name);
        }
      }
    }

    const selected: unknown = info.selectedTools;
    if (!Array.isArray(selected)) continue;
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
      const categoryName = item.category?.name?.toLowerCase() ?? '';
      const hints = categoryName === 'skill' ? skillHints : connectorHints;
      addHint(hints, label);
      if (item.toolkit) addHint(hints, item.toolkit);
    }
  }

  return { skillHints, connectorHints };
}

function runtimeCategoryForToolkit(
  toolkitName: string,
  skillHints: Set<string>,
  connectorHints: Set<string>
): ContextItem['category'] | null {
  const tn = toolkitName.trim().toLowerCase();
  if (/\bskill\b/i.test(tn)) return 'skill';
  if (/\bmcp\b/i.test(tn)) return 'connector';
  if (skillHints.has(tn)) return 'skill';
  const noTk = tn.replace(/\s+toolkit\s*$/i, '').trim();
  if (skillHints.has(noTk)) return 'skill';
  if (connectorHints.has(tn)) return 'connector';
  if (connectorHints.has(noTk)) return 'connector';
  return null;
}

function forEachRuntimeToolkit(
  agents: Agent[],
  taskRunning: TaskInfo[] | undefined,
  fn: (toolkitName: string) => void
) {
  for (const agent of agents) {
    for (const task of agent.tasks ?? []) {
      for (const tk of task.toolkits ?? []) {
        const name = tk.toolkitName;
        if (!name || name === 'notice') continue;
        fn(name);
      }
    }
  }
  for (const task of taskRunning ?? []) {
    for (const tk of task.toolkits ?? []) {
      const name = tk.toolkitName;
      if (!name || name === 'notice') continue;
      fn(name);
    }
  }
}

/**
 * Derive a flat, deduplicated list of context items (skills / MCP tools)
 * from runtime toolkit usage on subtasks of the active task.
 *
 * - `task.toolkits` / `taskRunning[].toolkits` from ACTIVATE_TOOLKIT are
 *   treated as the source of truth for "currently used" context.
 * - `workerInfo` is used only as a hint to classify runtime toolkit names as
 *   skill vs connector.
 */
export function buildContextItems(
  agents: Agent[],
  taskRunning?: TaskInfo[],
  uploadedFiles: File[] = []
): ContextItem[] {
  const seen = new Set<string>();
  const out: ContextItem[] = [];

  const push = (item: ContextItem) => {
    const key = `${item.category}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const { skillHints, connectorHints } = collectWorkerHintSets(agents);

  forEachRuntimeToolkit(agents, taskRunning, (toolkitName) => {
    const category = runtimeCategoryForToolkit(
      toolkitName,
      skillHints,
      connectorHints
    );
    if (!category) return;
    push({
      id: toolkitName,
      label: toolkitName,
      category,
      icon: getToolkitIcon(toolkitName, 16),
    });
  });

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
