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

import {
  Button,
  type ButtonLegacyVariant,
  type ButtonVariant,
} from '@/components/ui/button';
import { AnimatePresence, motion } from 'framer-motion';

type ConfirmVariant = ButtonVariant | ButtonLegacyVariant;

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: ConfirmVariant;
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = 'Confirm Title',
  message = 'Confirm content?',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'caution',
}: ConfirmModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Background overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="alert-dialog bg-black/20 inset-0 fixed z-[99]"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.2)' }}
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="alert-dialog-wrapper max-w-md rounded-xl fixed top-1/2 left-1/2 z-[100] -translate-x-1/2 -translate-y-1/2"
          >
            <div className="rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default p-6 shadow-perfect border">
              <span className="mb-2 text-body-lg font-bold text-ds-text-neutral-default-default">
                {title}
              </span>
              <p className="mb-6 text-label-md text-ds-text-neutral-muted-default">
                {message}
              </p>

              <div className="gap-3 flex justify-end">
                <Button variant="ghost" onClick={onClose}>
                  {cancelText}
                </Button>
                <Button
                  variant={confirmVariant}
                  onClick={() => {
                    onConfirm();
                    onClose();
                  }}
                >
                  {confirmText}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
