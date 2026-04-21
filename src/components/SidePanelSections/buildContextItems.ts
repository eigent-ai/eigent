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
import type { ContextItem } from './ContextSection';

/**
 * Derive a flat, deduplicated list of context items (skills / connectors /
 * tools) from a set of agents' workerInfo.
 *
 * - `workerInfo.tools: string[]` → category "tool"
 * - `workerInfo.mcp_tools.mcpServers: { [name]: config }` → category "connector"
 * - `workerInfo.selectedTools: McpItem[]` with `category.name` → category "skill"
 *   (fallback to connector if category is not "skill")
 */
export function buildContextItems(agents: Agent[]): ContextItem[] {
  const seen = new Set<string>();
  const out: ContextItem[] = [];

  const push = (item: ContextItem) => {
    const key = `${item.category}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  for (const agent of agents) {
    const info = agent.workerInfo;
    if (!info) continue;

    const tools: unknown = info.tools;
    if (Array.isArray(tools)) {
      for (const name of tools) {
        if (typeof name !== 'string' || !name) continue;
        push({
          id: name,
          label: name,
          category: 'tool',
          icon: getToolkitIcon(name, 16),
        });
      }
    }

    const mcp: unknown = info.mcp_tools;
    if (mcp && typeof mcp === 'object') {
      const servers = (mcp as { mcpServers?: Record<string, unknown> })
        .mcpServers;
      if (servers && typeof servers === 'object') {
        for (const name of Object.keys(servers)) {
          push({
            id: name,
            label: name,
            category: 'connector',
            icon: getToolkitIcon(name, 16),
          });
        }
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
        const categoryName = item.category?.name?.toLowerCase() ?? '';
        const category: ContextItem['category'] =
          categoryName === 'skill' ? 'skill' : 'connector';
        push({
          id: label,
          label,
          category,
          icon: getToolkitIcon(item.toolkit ?? label, 16),
        });
      }
    }
  }

  return out;
}
