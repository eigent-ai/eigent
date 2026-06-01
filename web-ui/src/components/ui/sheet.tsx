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

import { cn } from '@/lib/utils';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetTitle = DialogPrimitive.Title;

type SheetContentProps = React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> & {
  side?: 'left' | 'right' | 'top' | 'bottom';
  variant?: 'default' | 'ghost';
};

const sideClasses: Record<NonNullable<SheetContentProps['side']>, string> = {
  left: 'left-0 top-0 h-full',
  right: 'right-0 top-0 h-full',
  top: 'left-0 top-0 w-full',
  bottom: 'bottom-0 left-0 w-full',
};

const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(
  (
    { className, children, side = 'right', variant = 'default', ...props },
    ref
  ) => (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="bg-black/35 fixed inset-0 z-50" />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed z-50 bg-ds-bg-neutral-default-default shadow-xl',
          sideClasses[side],
          variant !== 'ghost' &&
            'border border-ds-border-neutral-subtle-default',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-3 top-3 rounded-full p-1 text-ds-icon-neutral-muted-default hover:bg-ds-bg-neutral-subtle-hover">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
);
SheetContent.displayName = DialogPrimitive.Content.displayName;

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger };
