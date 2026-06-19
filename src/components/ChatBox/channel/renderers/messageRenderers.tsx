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

import { ChatTaskStatus } from '@/types/constants';
import type {
  AgentMessageItem,
  ChainOfThoughtItem,
  ErrorItem,
  FileOutputItem,
  SkipMarkerItem,
  UserMessageItem,
} from '@/types/sessionChannel';
import { motion } from 'framer-motion';
import { ChevronDown, FileText } from 'lucide-react';
import React, { useState } from 'react';
import { AgentMessageCard } from '../../MessageItem/AgentMessageCard';
import { NoticeCard } from '../../MessageItem/NoticeCard';
import { UserMessageCard } from '../../MessageItem/UserMessageCard';
import type { ChannelRenderer } from '../context';

/** File chips footer (extracted from UserQueryGroup:444-474). */
const FileChips: React.FC<{
  id: string;
  files: FileInfo[];
  onOpen: (file: FileInfo) => void;
}> = ({ id, files, onOpen }) => (
  <div className="my-2 gap-2 flex flex-wrap">
    {files.map((file, fileIndex) => (
      <motion.div
        key={`file-${id}-${file.name}-${fileIndex}`}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.05 }}
        onClick={() => onOpen(file)}
        className="gap-2 rounded-lg bg-ds-bg-neutral-default-default px-3 py-2 hover:bg-ds-bg-neutral-default-hover flex w-[140px] cursor-pointer items-center transition-colors"
      >
        <FileText
          size={16}
          className="text-ds-icon-neutral-default-default flex-shrink-0"
        />
        <div className="flex flex-col">
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

/** Collapsible per-agent result (mirrors UserQueryGroup's AgentResultCard). */
const AgentResultCard: React.FC<{
  id: string;
  agentName?: string;
  content: string;
  defaultOpen?: boolean;
}> = ({ id, agentName, content, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="px-2 overflow-hidden">
      <button
        type="button"
        className="focus-visible:ring-ds-border-brand-default-focus/40 gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active flex w-full items-center text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
        onClick={() => setIsOpen((v) => !v)}
      >
        <span className="min-w-0 flex-1 truncate">{agentName || 'Agent'}</span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-ds-icon-neutral-default-default shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
        />
      </button>
      <div
        className={`ease-in-out overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        <div className="border-ds-border-neutral-default-default px-1 py-1 border-t">
          <AgentMessageCard
            id={id}
            content={content}
            typewriter={false}
            onTyping={() => {}}
          />
        </div>
      </div>
    </div>
  );
};

export const UserMessageRenderer: ChannelRenderer<UserMessageItem> = ({
  item,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    className="px-sm py-sm"
  >
    <UserMessageCard
      id={item.id}
      content={item.content}
      attaches={item.attaches}
    />
  </motion.div>
);

export const AgentMessageRenderer: ChannelRenderer<AgentMessageItem> = ({
  item,
  ctx,
}) => {
  if (item.variant === 'agent-end') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="px-6"
      >
        <AgentResultCard
          id={item.id}
          agentName={item.agentName}
          content={item.content}
          defaultOpen
        />
      </motion.div>
    );
  }

  // Typewriter only for the latest agent message while the turn is running.
  const resolved = ctx.resolveTurn(item.turnId);
  const task = resolved?.chatStore.getState().tasks[resolved.taskId];
  const replayAllows =
    task?.type !== 'replay' ||
    (task?.type === 'replay' && task?.delayTime !== 0);
  const msgs = task?.messages ?? [];
  const last = msgs[msgs.length - 1];
  const typewriter =
    replayAllows &&
    task?.status === ChatTaskStatus.RUNNING &&
    !!last &&
    last.role === 'agent' &&
    last.id === item.id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="gap-4 flex flex-col"
    >
      <AgentMessageCard
        id={item.id}
        content={item.content}
        typewriter={typewriter}
        onTyping={() => {}}
        deferredFooter={
          item.fileList?.length ? (
            <FileChips
              id={item.id}
              files={item.fileList}
              onOpen={(file) => ctx.openFilePreview(item.turnId, file)}
            />
          ) : undefined
        }
      />
    </motion.div>
  );
};

const SKIP_LABEL: Record<SkipMarkerItem['reason'], string> = {
  timeout: 'No reply received — continuing',
  agent: 'Skipped — continuing',
  'user-stop': 'Stopped — continuing',
};

/**
 * Skip divider (Stage 4): a skip does NOT end the turn. It renders as a
 * continuation divider in the same turn; subsequent work-log / agent content
 * flows below it under the same `turnId` (no new turn boundary, no "Run N").
 */
export const SkipMarkerRenderer: ChannelRenderer<SkipMarkerItem> = ({
  item,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.15 }}
    className="gap-3 px-6 py-2 flex items-center"
  >
    <div className="bg-ds-border-neutral-default-default h-px flex-1" />
    <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
      {SKIP_LABEL[item.reason]}
    </span>
    <div className="bg-ds-border-neutral-default-default h-px flex-1" />
  </motion.div>
);

export const ErrorRenderer: ChannelRenderer<ErrorItem> = ({ item }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.2 }}
    className="gap-4 flex flex-col"
  >
    <AgentMessageCard id={item.id} content={item.content} onTyping={() => {}} />
  </motion.div>
);

export const ChainOfThoughtRenderer: ChannelRenderer<
  ChainOfThoughtItem
> = () => <NoticeCard />;

export const FileOutputRenderer: ChannelRenderer<FileOutputItem> = ({
  item,
  ctx,
}) => (
  <FileChips
    id={item.id}
    files={item.files}
    onOpen={(file) => ctx.openFilePreview(item.turnId, file)}
  />
);
