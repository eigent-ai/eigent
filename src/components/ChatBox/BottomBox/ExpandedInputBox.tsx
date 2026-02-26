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

import { AddWorker } from '@/components/AddWorker';
import { Button } from '@/components/ui/button';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { cn } from '@/lib/utils';
import { useWorkerList } from '@/store/authStore';
import { motion } from 'framer-motion';
import { Bird, Bot, CodeXml, FileText, Globe, Image, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Inputbox, InputboxProps } from './InputBox';

/**
 * Prompt example for ActionBox
 */
interface PromptExample {
  title: string;
  prompt: string;
}

// TODO: Add prompt examples here
const defaultPromptExamples: PromptExample[] = [];

/**
 * ExpandedInputBox Props
 */
export interface ExpandedInputBoxProps {
  /** Props to pass through to Inputbox */
  inputProps: InputboxProps;
  /** Callback when close is triggered */
  onClose?: () => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * ExpandedInputBox Component
 *
 * A larger input panel for composing longer messages.
 * Features:
 * - BoxHeader: Shows list of agents + close button
 * - InputSection: Larger textarea
 * - ActionBox: Expandable prompt examples with horizontal scroll
 */
export const ExpandedInputBox = ({
  inputProps,
  onClose,
  className,
}: ExpandedInputBoxProps) => {
  const { t } = useTranslation();
  const { chatStore } = useChatStoreAdapter();
  const workerList = useWorkerList();
  const [agentList, setAgentList] = useState<Agent[]>([]);

  // Base workers - same as WorkSpaceMenu
  const baseWorker: Agent[] = useMemo(
    () => [
      {
        tasks: [],
        agent_id: 'developer_agent',
        name: t('layout.developer-agent'),
        type: 'developer_agent',
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        agent_id: 'browser_agent',
        name: t('layout.browser-agent'),
        type: 'browser_agent',
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        agent_id: 'multi_modal_agent',
        name: t('layout.multi-modal-agent'),
        type: 'multi_modal_agent',
        log: [],
        activeWebviewIds: [],
      },
      {
        tasks: [],
        agent_id: 'document_agent',
        name: t('layout.document-agent'),
        type: 'document_agent',
        log: [],
        activeWebviewIds: [],
      },
    ],
    [t]
  );

  // Agent icon map
  const agentIconMap: Record<string, React.ReactNode> = {
    developer_agent: <CodeXml className="h-3 w-3 text-emerald-600" />,
    search_agent: <Globe className="h-3 w-3 text-blue-600" />,
    document_agent: <FileText className="h-3 w-3 text-yellow-600" />,
    multi_modal_agent: <Image className="h-3 w-3 text-fuchsia-600" />,
    social_medium_agent: <Bird className="h-3 w-3 text-purple-600" />,
  };

  // Build agent list same as WorkSpaceMenu
  useEffect(() => {
    if (!chatStore?.activeTaskId) return;
    const activeTask = chatStore.tasks[chatStore.activeTaskId];
    const taskAssigning = activeTask?.taskAssigning || [];
    const base = [...baseWorker, ...workerList].filter(
      (worker) => !taskAssigning.find((agent) => agent.type === worker.type)
    );
    setAgentList([...base, ...taskAssigning]);
  }, [chatStore?.activeTaskId, chatStore?.tasks, workerList, baseWorker]);

  const handlePromptClick = (prompt: string) => {
    inputProps.onChange?.(prompt);
  };

  // Get display agents (limit to show)
  const displayAgents = agentList.slice(0, 6);
  const remainingCount = agentList.length > 6 ? agentList.length - 6 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={cn(
        'fixed left-1/2 top-1/2 z-30',
        'min-w-[600px] max-w-[760px]',
        'rounded-2xl border border-solid border-border-tertiary bg-surface-primary backdrop-blur-md',
        'perfect-shadow',
        'flex flex-col',
        className
      )}
      style={{
        x: '-50%',
        y: '-50%',
        transformOrigin: 'center center',
      }}
    >
      {/* BoxHeader */}
      <div className="flex items-center justify-between gap-4 border-b border-border-tertiary px-4 py-3">
        {/* Agent List */}
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {displayAgents.map((agent: Agent, index: number) => (
              <div
                key={agent.agent_id || index}
                className="flex items-center gap-1 rounded-full bg-surface-tertiary px-2 py-1 text-xs text-text-body"
                title={agent.name}
              >
                {agentIconMap[agent.type] || (
                  <Bot className="h-3 w-3 text-icon-secondary" />
                )}
                <span className="max-w-20 truncate">{agent.name}</span>
              </div>
            ))}
            {remainingCount > 0 && (
              <div className="rounded-full bg-surface-tertiary px-2 py-1 text-xs text-text-label">
                +{remainingCount}
              </div>
            )}
            {agentList.length === 0 && (
              <span className="text-xs italic text-text-label">
                {t('chat.no-agents-added')}
              </span>
            )}
            {/* Add Worker Button */}
            <AddWorker variant="icon" />
          </div>
        </div>

        {/* Close Button */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={onClose}
          >
            <X className="h-4 w-4 text-icon-secondary" />
          </Button>
        </div>
      </div>

      {/* InputSection */}
      <div className="flex-1 px-4">
        <Inputbox
          className="min-h-40"
          hideExpandButton={true}
          {...inputProps}
        />
      </div>

      {/* ActionBox - Prompt Examples Always Visible */}
      <div className="border-t border-border-tertiary">
        {/* Prompt Cards - Horizontal Scroll */}
        <div className="scrollbar-hide overflow-x-auto px-4 py-3">
          <div className="flex gap-2">
            {defaultPromptExamples.map((example, index) => (
              <button
                key={index}
                onClick={() => handlePromptClick(example.prompt)}
                className={cn(
                  'w-48 flex-shrink-0 rounded-xl p-3',
                  'border border-border-tertiary bg-surface-tertiary',
                  'hover:bg-surface-tertiary-hover hover:border-border-secondary',
                  'transition-all duration-200',
                  'text-left'
                )}
              >
                <div className="mb-1 text-xs font-medium text-text-body">
                  {example.title}
                </div>
                <div className="line-clamp-2 text-xs text-text-label">
                  {example.prompt}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
