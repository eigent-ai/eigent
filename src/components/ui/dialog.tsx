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
import { AlertCircle, ChevronLeft, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'bg-black/50 fixed inset-0 z-50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export type DialogOverlayVariant = 'default' | 'dark';

// Size variants for dialog content
const dialogContentVariants = cva(
  'fixed left-[50%] top-[50%] z-50 grid w-full translate-x-[-50%] translate-y-[-50%] gap-0 border border-solid border-popup-border bg-popup-bg shadow-perfect duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl max-h-[90vh] flex flex-col overflow-hidden',
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
  /** Overlay behind the dialog: 'default' (transparent) or 'dark' (black overlay) */
  overlayVariant?: DialogOverlayVariant;
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
      ...props
    },
    ref
  ) => (
    <DialogPortal>
      <DialogOverlay
        className={overlayVariant === 'dark' ? 'bg-black/40' : undefined}
        style={
          overlayVariant === 'dark'
            ? { backgroundColor: 'rgba(0, 0, 0, 0.4)' }
            : undefined
        }
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          dialogContentVariants({ size }),
          overlayVariant === 'dark' && 'z-[51]',
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'absolute right-4 top-4 focus:outline-none focus:ring-0 focus:ring-offset-0',
                closeButtonClassName
              )}
              onClick={onClose}
            >
              {closeButtonIcon || <X className="h-4 w-4" />}
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
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
        'relative flex w-full shrink-0 items-center justify-between gap-2 overflow-hidden rounded-t-xl bg-popup-surface p-4',
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        {showBackButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onBackClick}
            className="h-6 w-6 p-0 hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4 text-icon-primary" />
          </Button>
        )}
        <div className="flex flex-col text-center sm:text-left">
          {title && (
            <div className="flex items-center gap-1">
              <DialogPrimitive.Title asChild>
                <span className="my-[1px] text-body-md font-bold text-text-heading">
                  {title}
                </span>
              </DialogPrimitive.Title>
              {showTooltip && tooltip && (
                <TooltipSimple content={tooltip}>
                  <AlertCircle className="h-4 w-4 text-icon-primary" />
                </TooltipSimple>
              )}
            </div>
          )}
          {subtitle && (
            <DialogPrimitive.Description asChild>
              <span className="mt-1 text-label-sm font-extralight text-text-label">
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
  <div ref={ref} className={cn('min-h-0 flex-1 p-4', className)} {...props} />
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
  confirmButtonVariant?:
    | 'primary'
    | 'secondary'
    | 'outline'
    | 'ghost'
    | 'success'
    | 'cuation'
    | 'information'
    | 'warning';
  cancelButtonVariant?:
    | 'primary'
    | 'secondary'
    | 'outline'
    | 'ghost'
    | 'success'
    | 'cuation'
    | 'information'
    | 'warning';
  confirmButtonDisabled?: boolean;
  cancelButtonDisabled?: boolean;
}

const DialogFooter = React.forwardRef<HTMLDivElement, DialogFooterProps>(
  (
    {
      className,
      showConfirmButton = false,
      showCancelButton = false,
      confirmButtonText = 'Confirm',
      cancelButtonText = 'Cancel',
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
    const footerRef = React.useRef<HTMLDivElement>(null);
    const [hasScrollbar, setHasScrollbar] = React.useState(false);

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
          'relative flex w-full shrink-0 items-center justify-end gap-2 px-4 pb-4 pt-2',
          hasScrollbar &&
            'border-x-0 border-b-0 border-t-[0.5px] border-solid border-border-secondary',
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
    className={cn('text-body-sm font-bold text-text-heading', className)}
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
    className={cn('text-label-sm text-text-label', className)}
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
