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
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

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
  hideCancel?: boolean;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title: titleProp,
  message: messageProp,
  confirmText: confirmTextProp,
  cancelText: cancelTextProp,
  confirmVariant = 'caution',
  hideCancel = false,
  confirmDisabled = false,
  children,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const title = titleProp ?? t('layout.confirm');
  const message = messageProp ?? t('layout.confirm-content');
  const confirmText = confirmTextProp ?? t('layout.confirm');
  const cancelText = cancelTextProp ?? t('layout.cancel');

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Background overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="alert-dialog fixed inset-0 z-[99] bg-dialog-overlay-scrim"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="alert-dialog-wrapper fixed left-1/2 top-1/2 z-[100] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl"
          >
            <div className="rounded-xl border border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-6 shadow-perfect">
              <span
                id={titleId}
                className="mb-2 block text-body-lg font-bold text-ds-text-neutral-default-default"
              >
                {title}
              </span>
              {children ? (
                <div id={descriptionId} className="mb-6">
                  {children}
                </div>
              ) : (
                <span
                  id={descriptionId}
                  className="mb-6 block text-label-md text-ds-text-neutral-muted-default"
                >
                  {message}
                </span>
              )}

              <div className="flex justify-end gap-3">
                {!hideCancel && (
                  <Button variant="ghost" onClick={onClose}>
                    {cancelText}
                  </Button>
                )}
                <Button
                  variant={confirmVariant}
                  disabled={confirmDisabled}
                  onClick={() => {
                    if (confirmDisabled) return;
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
    </AnimatePresence>,
    document.body
  );
}
