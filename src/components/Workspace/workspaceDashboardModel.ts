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

export const WORKSPACE_DASHBOARD_SECTIONS = [
  'overview',
  'accounts',
  'delivery',
  'approvals',
  'launch',
  'risks',
] as const;

export type WorkspaceDashboardSection =
  (typeof WORKSPACE_DASHBOARD_SECTIONS)[number] | 'todos';

export interface WorkspaceDashboardConfig {
  version: 1;
  sources: Partial<Record<WorkspaceDashboardSection, string[]>>;
}

export interface WorkspaceMarkdownTask {
  id: string;
  checked: boolean;
  text: string;
  heading?: string;
  line: number;
}

const EMPTY_DASHBOARD_CONFIG: WorkspaceDashboardConfig = {
  version: 1,
  sources: {},
};

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function isWorkspaceDashboardMarkdownFile(file: FileInfo): boolean {
  const path = (file.relativePath || file.name || file.path)
    .split(/[?#]/)[0]
    .toLowerCase();
  return (
    !file.isFolder &&
    (path.endsWith('.md') ||
      path.endsWith('.mdx') ||
      path.endsWith('.markdown'))
  );
}

export function getWorkspaceDashboardFileId(file: FileInfo): string {
  const displayPath = normalizePath(
    file.relativePath || file.name || file.path
  );
  if (!file.project_id) return displayPath;

  // Remote Files prefixes the human-readable Project name for display. Keep
  // that label out of the durable identity so renaming a Project does not
  // break its dashboard links.
  const projectRelativePath = displayPath.includes('/')
    ? displayPath.slice(displayPath.indexOf('/') + 1)
    : displayPath;
  return `${file.project_id}:${projectRelativePath}`;
}

export function readWorkspaceDashboardConfig(
  metadata: Record<string, unknown> | null | undefined
): WorkspaceDashboardConfig {
  const value = metadata?.workspaceDashboard;
  if (!value || typeof value !== 'object') return EMPTY_DASHBOARD_CONFIG;

  const rawSources = (value as Record<string, unknown>).sources;
  if (!rawSources || typeof rawSources !== 'object') {
    return EMPTY_DASHBOARD_CONFIG;
  }

  const sources: WorkspaceDashboardConfig['sources'] = {};
  const validSections = new Set<WorkspaceDashboardSection>([
    ...WORKSPACE_DASHBOARD_SECTIONS,
    'todos',
  ]);

  Object.entries(rawSources as Record<string, unknown>).forEach(
    ([section, ids]) => {
      if (!validSections.has(section as WorkspaceDashboardSection)) return;
      if (!Array.isArray(ids)) return;
      sources[section as WorkspaceDashboardSection] = [
        ...new Set(
          ids.filter(
            (id): id is string => typeof id === 'string' && id.length > 0
          )
        ),
      ];
    }
  );

  return { version: 1, sources };
}

export function updateWorkspaceDashboardSources(
  config: WorkspaceDashboardConfig,
  section: WorkspaceDashboardSection,
  sourceIds: readonly string[]
): WorkspaceDashboardConfig {
  return {
    version: 1,
    sources: {
      ...config.sources,
      [section]: [...new Set(sourceIds)],
    },
  };
}

export function parseWorkspaceMarkdownTasks(
  content: string,
  fileId: string
): WorkspaceMarkdownTask[] {
  const tasks: WorkspaceMarkdownTask[] = [];
  let activeHeading: string | undefined;

  content.split(/\r?\n/).forEach((line, index) => {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      activeHeading = headingMatch[1]?.trim() || undefined;
      return;
    }

    const taskMatch = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/);
    if (!taskMatch) return;

    tasks.push({
      id: `${fileId}:${index + 1}`,
      checked: taskMatch[1]?.toLowerCase() === 'x',
      text: taskMatch[2]?.trim() || '',
      heading: activeHeading,
      line: index + 1,
    });
  });

  return tasks;
}
