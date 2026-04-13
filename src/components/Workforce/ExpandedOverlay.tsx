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

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const EDGE_PADDING_PX = 32;

export interface ExpandedOverlayProps {
  open: boolean;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
  bottomBar: ReactNode;
  /** Dialog / surface accessible name */
  titleLabel: string;
  /** Label for the dimmed backdrop control (dismiss) */
  backdropDismissLabel: string;
}

export default function ExpandedOverlay({
  open,
  onClose,
  header,
  children,
  bottomBar,
  titleLabel,
  backdropDismissLabel,
}: ExpandedOverlayProps) {
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
              {header}
            </div>
            <div className="min-h-0 min-w-0 w-full flex-1">{children}</div>
            <div className="relative z-50 shrink-0">{bottomBar}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
