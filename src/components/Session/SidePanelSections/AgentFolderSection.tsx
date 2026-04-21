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

import { SidePanelAccordionBox } from '@/components/Session/SidePanelAccordionBox';
import { SidePanelListRow } from '@/components/Session/SidePanelSections/primitives';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';

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

export function AgentFolderSection({
  title,
  files,
  onOpenFile,
}: AgentFolderSectionProps) {
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: FileInfo[] = [];
    for (const f of files) {
      const key = f.path || f.name;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }, [files]);

  return (
    <SidePanelAccordionBox title={title}>
      {unique.length === 0 ? (
        <div className="text-ds-text-neutral-muted-default text-body-sm px-1 py-1">
          No files yet
        </div>
      ) : (
        <motion.ul layout className="p-0 m-0 space-y-0.5 list-none">
          <AnimatePresence initial={false}>
            {unique.map((file) => {
              const Icon = iconFor(file);
              return (
                <motion.li
                  key={file.path || file.name}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <SidePanelListRow
                    leading={
                      <Icon
                        size={16}
                        className={cn('text-ds-icon-neutral-default-default')}
                      />
                    }
                    onClick={() => onOpenFile(file)}
                  >
                    {file.name || file.path}
                  </SidePanelListRow>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </SidePanelAccordionBox>
  );
}
