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

import { SidePanelAccordionBox } from '@/components/Session/SidePanel/components/AccordionBox';
import { SidePanelListRow } from '@/components/Session/SidePanel/sections/primitives';
import { isVisibleAgentFile } from '@/lib/agentFileFilters';
import { cn } from '@/lib/utils';
import {
  buildWorkspaceFileTree,
  type WorkspaceFileTreeNode,
} from '@/lib/workspaceFileTree';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder as FolderIcon,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

const EXT_MAP: Record<string, LucideIcon> = {
  // images
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  webp: FileImage,
  svg: FileImage,
  // video
  mp4: FileVideo,
  mov: FileVideo,
  webm: FileVideo,
  // audio
  mp3: FileAudio,
  wav: FileAudio,
  m4a: FileAudio,
  // archive
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  // spreadsheet
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  // code
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  json: FileCode,
  html: FileCode,
  // docs
  md: FileText,
  txt: FileText,
  pdf: FileText,
  doc: FileText,
  docx: FileText,
};

function iconFor(file: FileInfo): LucideIcon {
  const name = (file.name || file.path || '').toLowerCase();
  const idx = name.lastIndexOf('.');
  const ext = idx >= 0 ? name.slice(idx + 1) : '';
  return EXT_MAP[ext] ?? File;
}

interface AgentFolderSectionProps {
  title: string;
  files: FileInfo[];
  /** Opens the Folder workspace tab and selects this file (parent supplies navigation). */
  onOpenFile: (file: FileInfo) => void;
}

interface AgentFolderTreeProps {
  nodes: WorkspaceFileTreeNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (file: FileInfo) => void;
}

function AgentFolderTree({
  nodes,
  expandedFolders,
  onToggleFolder,
  onOpenFile,
}: AgentFolderTreeProps) {
  return (
    <AnimatePresence initial={false}>
      {nodes.map((node) => {
        const isExpanded =
          node.isFolder && expandedFolders.has(node.relativePath);
        const Icon = node.file ? iconFor(node.file) : File;

        return (
          <motion.li
            key={`${node.isFolder ? 'folder' : 'file'}:${node.relativePath}`}
            layout
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="m-0 list-none"
          >
            <SidePanelListRow
              leading={
                node.isFolder ? (
                  <span className="flex items-center gap-1">
                    {isExpanded ? (
                      <ChevronDown
                        size={14}
                        className="text-ds-icon-neutral-muted-default"
                      />
                    ) : (
                      <ChevronRight
                        size={14}
                        className="text-ds-icon-neutral-muted-default"
                      />
                    )}
                    {isExpanded ? (
                      <FolderOpen
                        size={16}
                        className="text-ds-icon-neutral-default-default"
                      />
                    ) : (
                      <FolderIcon
                        size={16}
                        className="text-ds-icon-neutral-default-default"
                      />
                    )}
                  </span>
                ) : (
                  <Icon
                    size={16}
                    className={cn('text-ds-icon-neutral-default-default')}
                  />
                )
              }
              onClick={() => {
                if (node.isFolder) {
                  onToggleFolder(node.relativePath);
                } else if (node.file) {
                  onOpenFile(node.file);
                }
              }}
            >
              <span title={node.relativePath}>{node.name}</span>
            </SidePanelListRow>

            {isExpanded && node.children.length > 0 ? (
              <ul className="m-0 ml-4 list-none border-y-0 border-l border-r-0 border-solid border-ds-border-neutral-subtle-default p-0 pl-1">
                <AgentFolderTree
                  nodes={node.children}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onOpenFile={onOpenFile}
                />
              </ul>
            ) : null}
          </motion.li>
        );
      })}
    </AnimatePresence>
  );
}

export function AgentFolderSection({
  title,
  files,
  onOpenFile,
}: AgentFolderSectionProps) {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: FileInfo[] = [];
    for (const f of files) {
      if (!isVisibleAgentFile(f)) continue;
      const key = f.path || f.name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }, [files]);
  const fileTree = useMemo(() => buildWorkspaceFileTree(unique), [unique]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set()
  );

  const toggleFolder = (path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <SidePanelAccordionBox title={title}>
      {unique.length === 0 ? (
        <div className="px-1 py-1 text-body-sm text-ds-text-neutral-subtle-default opacity-60">
          Files the agent writes or updates during this task appear here so you
          can open them.
        </div>
      ) : (
        <motion.ul
          layout
          className="m-0 max-h-96 list-none overflow-y-auto overscroll-contain p-0 pr-1"
        >
          <AgentFolderTree
            nodes={fileTree}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onOpenFile={onOpenFile}
          />
        </motion.ul>
      )}
    </SidePanelAccordionBox>
  );
}
