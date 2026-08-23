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

'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { motion, useReducedMotion } from 'framer-motion';
import { AlertCircle, ChevronLeft, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  type ButtonLegacyVariant,
  type ButtonVariant,
} from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DIALOG_ENTER_EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];
const DIALOG_CENTERED_TRANSFORM = 'translate(-50%, -50%) scale(1)';

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-transparent backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * - `default` — transparent overlay (backdrop blur only).
 * - `light` — pure white @ 30% opacity scrim.
 * - `dark` — pure black @ 30% opacity scrim.
 * - `dimmed` — `--dialog-overlay-scrim` from the token engine (black ~30% when app mode is light, white ~30% when dark; ThemeProvider reapplies vars — no Tailwind `dark:`).
 */
export type DialogOverlayVariant = 'default' | 'light' | 'dark' | 'dimmed';

// Size variants for dialog content
const dialogContentVariants = cva(
  'fixed left-[50%] top-[50%] z-50 grid w-full gap-0 overflow-hidden border border-solid border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default shadow-ds-elevation-dialog rounded-ds-dialog max-h-[90vh] flex flex-col',
  {
    variants: {
      size: {
        sm: 'max-w-[400px]',
        md: 'max-w-[600px]',
        lg: 'max-w-[900px]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  }
);

// Enhanced Dialog Content with size variants
interface DialogContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  showCloseButton?: boolean;
  closeButtonClassName?: string;
  closeButtonIcon?: React.ReactNode;
  onClose?: () => void;
  /** Overlay scrim: see {@link DialogOverlayVariant}. */
  overlayVariant?: DialogOverlayVariant;
  /** Merged onto the overlay (e.g. `backdrop-blur-none` to disable default blur) */
  overlayClassName?: string;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      size,
      showCloseButton = true,
      closeButtonClassName,
      closeButtonIcon,
      onClose,
      overlayVariant = 'default',
      overlayClassName,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const shouldReduceMotion = Boolean(useReducedMotion());

    return (
      <DialogPortal>
        <DialogOverlay
          className={cn(
            overlayVariant === 'light' && 'bg-dialog-overlay-light',
            overlayVariant === 'dark' && 'bg-dialog-overlay-dark',
            overlayVariant === 'dimmed' && 'bg-dialog-overlay-scrim',
            overlayClassName
          )}
        />
        <DialogPrimitive.Content ref={ref} asChild {...props}>
          <motion.div
            initial={{
              opacity: 0,
              transform: shouldReduceMotion
                ? DIALOG_CENTERED_TRANSFORM
                : 'translate(-50%, -50%) scale(0.95)',
            }}
            animate={{
              opacity: 1,
              transform: DIALOG_CENTERED_TRANSFORM,
            }}
            transition={{ duration: 0.2, ease: DIALOG_ENTER_EASE }}
            style={{ transformOrigin: 'center' }}
            className={cn(
              dialogContentVariants({ size }),
              overlayVariant !== 'default' && 'z-[51]',
              className
            )}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  buttonContent="icon-only"
                  className={cn('absolute top-4 right-4', closeButtonClassName)}
                  onClick={onClose}
                >
                  {closeButtonIcon || <X className="h-4 w-4" aria-hidden />}
                  <span className="sr-only">{t('layout.close')}</span>
                </Button>
              </DialogPrimitive.Close>
            )}
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

// Enhanced Dialog Header with title, subtitle, and tooltip support
interface DialogHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  subtitle?: string;
  tooltip?: string;
  showTooltip?: boolean;
  showBackButton?: boolean;
  onBackClick?: () => void;
}

const DialogHeader = React.forwardRef<HTMLDivElement, DialogHeaderProps>(
  (
    {
      className,
      title,
      subtitle,
      tooltip,
      showTooltip = false,
      showBackButton = false,
      onBackClick,
      children,
      ...props
    },
    ref
  ) => (
    <div
      ref={ref}
      className={cn(
        'relative flex w-full shrink-0 items-center justify-between gap-2 overflow-visible rounded-t-[var(--ds-radius-dialog)] bg-ds-neutral-subtle-default p-ds-16',
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {showBackButton && (
          <Button
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            onClick={onBackClick}
            className="hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4 text-ds-ink-default-default" />
          </Button>
        )}
        <div className="flex flex-col text-center sm:text-left">
          {title && (
            <div className="flex items-center gap-1">
              <DialogPrimitive.Title asChild>
                <span className="my-[1px] text-ds-text-title font-semibold text-ds-ink-default-default">
                  {title}
                </span>
              </DialogPrimitive.Title>
              {showTooltip && tooltip && (
                <TooltipSimple content={tooltip}>
                  <AlertCircle className="h-4 w-4 text-ds-ink-default-default" />
                </TooltipSimple>
              )}
            </div>
          )}
          {subtitle && (
            <DialogPrimitive.Description asChild>
              <span className="mt-1 text-ds-text-base font-normal text-ds-ink-muted-default">
                {subtitle}
              </span>
            </DialogPrimitive.Description>
          )}
        </div>
      </div>
      {children}
    </div>
  )
);
DialogHeader.displayName = 'DialogHeader';

// Enhanced Dialog Content section
const DialogContentSection = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('min-h-0 flex-1 overflow-auto p-ds-16', className)}
    {...props}
  />
));
DialogContentSection.displayName = 'DialogContentSection';

// Enhanced Dialog Footer with button support
interface DialogFooterProps extends React.HTMLAttributes<HTMLDivElement> {
  showConfirmButton?: boolean;
  showCancelButton?: boolean;
  confirmButtonText?: string;
  cancelButtonText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  confirmButtonVariant?: ButtonVariant | ButtonLegacyVariant;
  cancelButtonVariant?: ButtonVariant | ButtonLegacyVariant;
  confirmButtonDisabled?: boolean;
  cancelButtonDisabled?: boolean;
}

const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(
  (
    {
      className,
      showConfirmButton = false,
      showCancelButton = false,
      confirmButtonText: confirmButtonTextProp,
      cancelButtonText: cancelButtonTextProp,
      onConfirm,
      onCancel,
      confirmButtonVariant = 'primary',
      cancelButtonVariant = 'outline',
      confirmButtonDisabled = false,
      cancelButtonDisabled = false,
      children,
      ...props
    },
    ref
  ) => {
    const { t } = useTranslation();
    const footerRef = React.useRef<HTMLDivElement>(null);
    const [hasScrollbar, setHasScrollbar] = React.useState(false);
    const confirmButtonText = confirmButtonTextProp ?? t('layout.confirm');
    const cancelButtonText = cancelButtonTextProp ?? t('layout.cancel');

    // Combine local ref with forwarded ref
    React.useImperativeHandle(ref, () => footerRef.current as HTMLDivElement);

    React.useEffect(() => {
      const footer = footerRef.current;
      if (!footer) return;

      const parent = footer.parentElement;
      if (!parent) return;

      const checkScrollbar = () => {
        const siblings = Array.from(parent.children);
        const footerIndex = siblings.indexOf(footer);
        if (footerIndex === -1) return;

        // Find the most likely scrollable sibling (usually the one before footer)
        const scrollable = siblings
          .slice(0, footerIndex)
          .reverse()
          .find((el) => {
            const style = window.getComputedStyle(el);
            return (
              style.overflowY === 'auto' ||
              style.overflowY === 'scroll' ||
              el.classList.contains('scrollbar-overlay') ||
              el.classList.contains('scrollbar') ||
              el.scrollHeight > el.clientHeight
            );
          });

        if (scrollable) {
          setHasScrollbar(scrollable.scrollHeight > scrollable.clientHeight);
        } else {
          setHasScrollbar(false);
        }
      };

      checkScrollbar();

      const observer = new ResizeObserver(() => {
        checkScrollbar();
      });

      // Observe parent and its children for layout changes
      observer.observe(parent);
      Array.from(parent.children).forEach((child) => {
        if (child !== footer) observer.observe(child);
      });

      return () => observer.disconnect();
    }, []);

    return (
      <div
        ref={footerRef}
        className={cn(
          'relative flex w-full shrink-0 items-center justify-end gap-2 px-4 pt-2 pb-4',
          hasScrollbar &&
            'border-x-0 border-t-[length:var(--ds-border-hairline)] border-b-0 border-solid border-ds-hairline-default-default',
          className
        )}
        {...props}
      >
        {children}
        {showCancelButton && (
          <Button
            variant={cancelButtonVariant}
            size="sm"
            onClick={onCancel}
            disabled={cancelButtonDisabled}
          >
            {cancelButtonText}
          </Button>
        )}
        {showConfirmButton && (
          <Button
            variant={confirmButtonVariant}
            size="sm"
            onClick={onConfirm}
            disabled={confirmButtonDisabled}
          >
            {confirmButtonText}
          </Button>
        )}
      </div>
    );
  }
);
DialogFooter.displayName = 'DialogFooter';

// Legacy DialogTitle for backward compatibility
const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-ds-text-title font-semibold text-ds-ink-default-default',
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

// Legacy DialogDescription for backward compatibility
const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-ds-text-base text-ds-ink-muted-default', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogContentSection,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
