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
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useState, type ReactNode } from 'react';
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
  /** Let the owner close the dialog after an asynchronous confirmation. */
  closeOnConfirm?: boolean;
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
  closeOnConfirm = true,
  children,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const shouldReduceMotion = Boolean(useReducedMotion());
  // Read the focused element while rendering the open state: an autoFocus
  // field inside the dialog takes focus before any effect could see it.
  const [opening, setOpening] = useState<{
    open: boolean;
    returnFocus: Element | null;
  }>({ open: false, returnFocus: null });
  if (opening.open !== isOpen) {
    setOpening({
      open: isOpen,
      returnFocus:
        isOpen && typeof document !== 'undefined'
          ? document.activeElement
          : opening.returnFocus,
    });
  }
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

  // Radix owns Escape, outside press, the focus trap and stacking with other
  // dialogs; forceMount lets AnimatePresence play the exit.
  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={ALERT_DIALOG_TRANSITION}
                className="alert-dialog fixed inset-0 z-[99] bg-dialog-overlay-scrim"
              />
            </DialogPrimitive.Overlay>

            {/* Viewport-sized layer owns centering; the card only scales/fades. */}
            <div
              data-alert-dialog-viewport
              className="pointer-events-none fixed inset-0 z-[100] grid place-items-center p-4"
            >
              <DialogPrimitive.Content
                asChild
                forceMount
                role="alertdialog"
                onCloseAutoFocus={(event) => {
                  // There is no trigger; go back to where the user was.
                  event.preventDefault();
                  const { returnFocus } = opening;
                  if (returnFocus instanceof HTMLElement) returnFocus.focus();
                }}
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
                  className="alert-dialog-wrapper pointer-events-auto w-full max-w-[400px] overflow-hidden rounded-xl"
                >
                  <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default p-6 shadow-ds-elevation-dialog">
                    <DialogPrimitive.Title asChild>
                      <span className="mb-2 block !text-ds-text-section font-bold text-ds-ink-default-default">
                        {title}
                      </span>
                    </DialogPrimitive.Title>
                    {children ? (
                      <DialogPrimitive.Description asChild>
                        <div className="mb-6">{children}</div>
                      </DialogPrimitive.Description>
                    ) : (
                      <DialogPrimitive.Description asChild>
                        <span className="mb-6 block !text-ds-text-body-large text-ds-ink-muted-default">
                          {message}
                        </span>
                      </DialogPrimitive.Description>
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
                          if (closeOnConfirm) onClose();
                        }}
                      >
                        {confirmText}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
