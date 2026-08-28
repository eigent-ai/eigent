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

import { useAuthStore } from '@/store/authStore';
import { createPortal } from 'react-dom';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Only fold (stack) toasts when there are 3 or more. With 1–2 toasts they stay
 * fully expanded so both are always readable without hovering.
 *
 * Sonner folds via:
 *   [data-sonner-toast][data-expanded=false][data-front=false]  →  stacked CSS
 * We override that rule when the toaster contains fewer than 3 toast children.
 */
const FOLD_AT_THREE_CSS = `
  [data-sonner-toaster]:not(:has([data-sonner-toast]:nth-child(3)))
    [data-sonner-toast][data-expanded=false][data-front=false] {
    --y: translateY(calc(var(--lift) * var(--offset)));
    height: var(--initial-height);
  }
  [data-sonner-toaster]:not(:has([data-sonner-toast]:nth-child(3)))
    [data-sonner-toast][data-expanded=false][data-front=false][data-styled=true] > * {
    opacity: 1;
  }
  [data-sonner-toaster]:not(:has([data-sonner-toast]:nth-child(3)))
    [data-sonner-toast][data-expanded=false][data-front=false]::after {
    content: '';
    position: absolute;
    left: 0;
    height: calc(var(--gap) + 1px);
    bottom: 100%;
    width: 100%;
  }
`;

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAuthStore((state) => state.appearance);

  const toaster = (
    <>
      <style>{FOLD_AT_THREE_CSS}</style>
      <Sonner
        theme={theme}
        className="toaster group"
        toastOptions={{
          classNames: {
            toast:
              'group toast group-[.toaster]:bg-ds-neutral-subtle-default group-[.toaster]:text-ds-ink-default-default group-[.toaster]:border-ds-hairline-default-default group-[.toaster]:shadow-ds-elevation-floating',
            description: 'group-[.toast]:text-ds-ink-muted-default',
            actionButton:
              'group-[.toast]:bg-ds-accent-default-default group-[.toast]:text-ds-accent-on-default',
            cancelButton:
              'group-[.toast]:bg-ds-neutral-muted-default group-[.toast]:text-ds-ink-muted-default',
          },
        }}
        {...props}
      />
    </>
  );

  // Render into <body>, not inside #root. #root has `backdrop-filter`, which
  // creates a stacking context that would trap toasts *below* dialog/overlay
  // portals (also body-level) no matter how high their z-index is.
  if (typeof document === 'undefined') return toaster;
  return createPortal(toaster, document.body);
};

export { Toaster };
