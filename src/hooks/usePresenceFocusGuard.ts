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

import { useLayoutEffect, useRef, type RefObject } from 'react';

export function focusVisibleElement(element: HTMLElement | null): boolean {
  if (
    !element?.isConnected ||
    element.closest('[inert], [aria-hidden="true"]') ||
    element.matches(':disabled, [aria-disabled="true"]')
  ) {
    return false;
  }
  element.focus({ preventScroll: true });
  return element.ownerDocument.activeElement === element;
}

/** Move focus before hiding an exiting animation subtree from accessibility. */
export function usePresenceFocusGuard(
  elementRef: RefObject<HTMLElement | null>,
  isPresent: boolean,
  focusOnEnter = false
) {
  const entered = useRef(false);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const ownerDocument = element.ownerDocument;
    if (!isPresent) {
      const active = ownerDocument.activeElement;
      if (active instanceof HTMLElement && element.contains(active)) {
        active.blur();
      }
      element.setAttribute('inert', '');
      element.setAttribute('aria-hidden', 'true');
      return;
    }
    element.removeAttribute('inert');
    element.removeAttribute('aria-hidden');
    if (!focusOnEnter || entered.current) return;
    entered.current = true;
    // Child autoFocus already chose a field. Never override it or refocus
    // after asynchronous options arrive and the user may have moved on.
    if (element.contains(ownerDocument.activeElement)) return;
    const field = element.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), [role="combobox"]:not(:disabled):not([aria-disabled="true"])'
    );
    if (!focusVisibleElement(field)) {
      focusVisibleElement(
        element.querySelector<HTMLElement>('[data-resource-editor-close]')
      );
    }
  }, [elementRef, focusOnEnter, isPresent]);
}
