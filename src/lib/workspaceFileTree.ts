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

import { getWorkspaceRelativeFilePath } from '@/lib/workspaceRelativePath';

export interface WorkspaceFileTreeNode {
  name: string;
  relativePath: string;
  isFolder: boolean;
  children: WorkspaceFileTreeNode[];
  file?: FileInfo;
}

function sortNodes(nodes: WorkspaceFileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.isFolder !== right.isFolder) return left.isFolder ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  nodes.forEach((node) => sortNodes(node.children));
}

/** Build the Agent Folder hierarchy from paths scoped to the workspace root. */
export function buildWorkspaceFileTree(
  files: FileInfo[]
): WorkspaceFileTreeNode[] {
  const root: WorkspaceFileTreeNode = {
    name: '',
    relativePath: '',
    isFolder: true,
    children: [],
  };
  const folders = new Map<string, WorkspaceFileTreeNode>([['', root]]);

  for (const file of files) {
    const relativePath = getWorkspaceRelativeFilePath(file);
    const segments = relativePath.split('/').filter(Boolean);
    if (!segments.length) continue;

    let parent = root;
    let folderPath = '';
    for (const segment of segments.slice(0, -1)) {
      folderPath = folderPath ? `${folderPath}/${segment}` : segment;
      let folder = folders.get(folderPath);
      if (!folder) {
        folder = {
          name: segment,
          relativePath: folderPath,
          isFolder: true,
          children: [],
        };
        parent.children.push(folder);
        folders.set(folderPath, folder);
      }
      parent = folder;
    }

    parent.children.push({
      name: segments.at(-1) || file.name || 'File',
      relativePath,
      isFolder: false,
      children: [],
      file,
    });
  }

  sortNodes(root.children);
  return root.children;
}
