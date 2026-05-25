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
import type { ReplyBlock } from '@/components/ChatBox/renderSession/types';
import { useHost } from '@/host';
import { FileText } from 'lucide-react';
import { motion } from 'motion/react';
import React from 'react';

interface Props {
  block: Extract<ReplyBlock, { kind: 'files' }>;
}

export const FilesReplyBlock: React.FC<Props> = ({ block }) => {
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;

  if (!block.files.length) return null;

  return (
    <div className="my-2 gap-2 flex flex-wrap">
      {block.files.map((file, idx) => (
        <motion.div
          key={`${file.name}-${idx}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.05 * idx }}
          onClick={() => {
            ipcRenderer?.invoke(
              'reveal-in-folder',
              (file as any).filePath ?? file.name
            );
          }}
          className="gap-2 rounded-lg bg-ds-bg-neutral-default-default px-3 py-2 hover:bg-ds-bg-neutral-default-hover flex w-[140px] cursor-pointer items-center transition-colors"
        >
          <FileText
            size={16}
            className="text-ds-icon-neutral-default-default flex-shrink-0"
          />
          <div className="flex flex-col overflow-hidden">
            <div className="text-body-sm font-bold text-ds-text-neutral-default-default max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap">
              {file.name.split('.')[0]}
            </div>
            <div className="text-label-xs font-medium text-ds-text-neutral-muted-default">
              {file.type}
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};
