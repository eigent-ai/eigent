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
  type ButtonTone,
  type ButtonVariant,
} from '@/components/ui/button';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

type ConfirmVariant = ButtonVariant | ButtonLegacyVariant;

const ALERT_DIALOG_TRANSITION = {
  duration: 0.2,
  ease: [0.23, 1, 0.32, 1] as [number, number, number, number],
};

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: ConfirmVariant;
  confirmTone?: ButtonTone;
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
  confirmVariant,
  confirmTone,
  hideCancel = false,
  confirmDisabled = false,
  children,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const titleId = useId();
  const descriptionId = useId();
  const title = titleProp ?? t('layout.confirm');
  const message = messageProp ?? t('layout.confirm-content');
  const confirmText = confirmTextProp ?? t('layout.confirm');
  const cancelText = cancelTextProp ?? t('layout.cancel');
  const isLegacyCaution = confirmVariant === 'caution';
  const resolvedVariant: ConfirmVariant =
    confirmVariant == null || isLegacyCaution ? 'primary' : confirmVariant;
  const resolvedTone: ButtonTone | undefined =
    confirmVariant == null || isLegacyCaution
      ? (confirmTone ?? 'error')
      : confirmTone;

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
            transition={ALERT_DIALOG_TRANSITION}
            className="alert-dialog fixed inset-0 z-[99] bg-dialog-overlay-scrim"
            onClick={onClose}
          />

          {/* Viewport-sized layer owns centering; the card only scales/fades. */}
          <div
            data-alert-dialog-viewport
            className="pointer-events-none fixed inset-0 z-[100] grid place-items-center p-4"
          >
            <motion.div
              initial={{
                opacity: 0,
                transform: shouldReduceMotion ? 'scale(1)' : 'scale(0.95)',
              }}
              animate={{ opacity: 1, transform: 'scale(1)' }}
              exit={{
                opacity: 0,
                transform: shouldReduceMotion ? 'scale(1)' : 'scale(0.95)',
              }}
              transition={ALERT_DIALOG_TRANSITION}
              style={{ transformOrigin: 'center' }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              className="alert-dialog-wrapper pointer-events-auto w-full max-w-[400px] overflow-hidden rounded-xl"
            >
              <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default p-6 shadow-ds-elevation-dialog">
                <span
                  id={titleId}
                  className="mb-2 block !text-ds-text-section font-bold text-ds-ink-default-default"
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
                    className="mb-6 block !text-ds-text-body-large text-ds-ink-muted-default"
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
                    variant={resolvedVariant}
                    tone={resolvedTone}
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
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
