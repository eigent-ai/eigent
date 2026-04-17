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

import BottomBar from '@/components/BottomBar';
import BrowserAgentWorkspace from '@/components/BrowserAgentWorkSpace';
import Folder from '@/components/Folder';
import TerminalAgentWorkspace from '@/components/TerminalAgentWorkspace';
import Workflow from '@/components/WorkFlow';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

const EDGE_PADDING_PX = 32;

export interface ExpandedOverlayProps {
  open: boolean;
  onClose: () => void;
  workforcePanelKey: string;
  onToggleSidePanel: () => void;
  isSidePanelVisible: boolean;
  onOpenAddWorker: () => void;
}

function WorkforceOverlayCanvas() {
  const { chatStore } = useChatStoreAdapter();
  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : null;
  const activeWorkSpace = activeTask?.activeWorkspace;

  if (!chatStore || !activeTask || !activeWorkSpace) {
    return (
      <div className="flex h-full w-full flex-1 items-center justify-center">
        <div className="relative flex h-full w-full flex-col">
          <div className="inset-0 rounded-xl pointer-events-none absolute bg-transparent"></div>
          <div className="relative z-10 h-full w-full">
            <Workflow taskAssigning={[]} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {activeTask.taskAssigning?.find(
        (agent) => agent.agent_id === activeWorkSpace
      )?.type === 'browser_agent' && (
        <div className="flex h-full w-full flex-1">
          <BrowserAgentWorkspace />
        </div>
      )}
      {activeWorkSpace === 'workflow' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="inset-0 rounded-xl pointer-events-none absolute bg-transparent"></div>
            <div className="relative z-10 h-full w-full">
              <Workflow taskAssigning={activeTask.taskAssigning || []} />
            </div>
          </div>
        </div>
      )}
      {activeTask.taskAssigning?.find(
        (agent) => agent.agent_id === activeWorkSpace
      )?.type === 'developer_agent' && (
        <div className="flex h-full w-full flex-1">
          <TerminalAgentWorkspace />
        </div>
      )}
      {activeWorkSpace === 'documentWorkSpace' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
            <div className="relative z-10 h-full w-full">
              <Folder />
            </div>
          </div>
        </div>
      )}
      {activeTask.taskAssigning?.find(
        (agent) => agent.agent_id === activeWorkSpace
      )?.type === 'document_agent' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
            <div className="relative z-10 h-full w-full">
              <Folder
                data={activeTask.taskAssigning?.find(
                  (agent) => agent.agent_id === activeWorkSpace
                )}
              />
            </div>
          </div>
        </div>
      )}
      {activeWorkSpace === 'inbox' && (
        <div className="flex h-full w-full flex-1 items-center justify-center">
          <div className="relative flex h-full w-full flex-col">
            <div className="blur-bg inset-0 rounded-xl bg-surface-secondary pointer-events-none absolute"></div>
            <div className="relative z-10 h-full w-full">
              <Folder />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ExpandedOverlay({
  open,
  onClose,
  workforcePanelKey,
  onToggleSidePanel,
  isSidePanelVisible,
  onOpenAddWorker,
}: ExpandedOverlayProps) {
  const { t } = useTranslation();
  const { chatStore } = useChatStoreAdapter();
  const workflowResetForOpenRef = useRef(false);

  /** When the overlay opens, show workflow canvas with no agent workspace selected. */
  useEffect(() => {
    if (!open) {
      workflowResetForOpenRef.current = false;
      return;
    }
    if (workflowResetForOpenRef.current) return;
    const taskId = chatStore?.activeTaskId;
    if (!taskId || !chatStore) return;
    workflowResetForOpenRef.current = true;
    chatStore.setActiveWorkspace(taskId, 'workflow');
    chatStore.setActiveAgent(taskId, '');
    window.electronAPI?.hideAllWebview?.();
  }, [open, chatStore]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  const titleLabel = t('layout.aiWorkforce');
  const backdropDismissLabel = t('layout.close');

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="workforce-expanded-overlay"
          className="inset-0 backdrop-blur-sm fixed z-[200] flex items-stretch justify-stretch bg-[rgba(0,0,0,0.5)]"
          style={{ padding: EDGE_PADDING_PX }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
        >
          <button
            type="button"
            aria-label={backdropDismissLabel}
            className="inset-0 absolute z-0 cursor-default bg-transparent"
            onClick={onClose}
          />
          <motion.div
            className="border-border-tertiary bg-surface-secondary min-h-0 min-w-0 rounded-2xl shadow-lg relative z-10 flex flex-1 flex-col overflow-hidden border border-solid"
            role="dialog"
            aria-modal="true"
            aria-label={titleLabel}
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            <div className="gap-2 p-2 relative z-50 flex w-full shrink-0 items-center justify-between">
              <div className="min-w-0 gap-3 flex flex-1 items-center overflow-hidden">
                <span className="text-text-heading px-1 text-body-md font-semibold shrink-0">
                  {titleLabel}
                </span>
              </div>
              <div className="gap-1 flex shrink-0 items-center">
                <Button
                  variant="primary"
                  size="sm"
                  className="rounded-lg items-center justify-center"
                  onClick={onOpenAddWorker}
                >
                  <Plus />
                  {t('triggers.add')}
                </Button>
                <TooltipSimple
                  content={backdropDismissLabel}
                  delayDuration={300}
                  side="bottom"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    buttonRadius="lg"
                    className="shrink-0"
                    onClick={onClose}
                    aria-pressed={true}
                    aria-label={backdropDismissLabel}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipSimple>
              </div>
            </div>
            <div className="min-h-0 min-w-0 w-full flex-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`overlay-${workforcePanelKey}`}
                  initial={{ opacity: 0, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, filter: 'blur(0px)' }}
                  exit={{ opacity: 0, filter: 'blur(4px)' }}
                  transition={{ duration: 0.2 }}
                  className="min-w-0 h-full w-full"
                >
                  <WorkforceOverlayCanvas />
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="relative z-50 shrink-0">
              <div className="pointer-events-auto">
                <BottomBar
                  onToggleChatBox={onToggleSidePanel}
                  isChatBoxVisible={!isSidePanelVisible}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
