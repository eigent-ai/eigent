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

/**
 * Every neutral title-bar control paints the same fill for hover, focus,
 * active, and open/selected: `bg-neutral-subtle-default`. Brand CTAs (e.g. the
 * update button) keep their own tone.
 *
 * `!` is needed because the `Button` ghost tone ships its own
 * hover/active/focus fills at the same specificity.
 */
export const TOP_BAR_CONTROL_STATE_CLASS = [
  'hover:!bg-ds-bg-neutral-subtle-default',
  'focus:!bg-ds-bg-neutral-subtle-default',
  'active:!bg-ds-bg-neutral-subtle-default',
  'data-[state=open]:!bg-ds-bg-neutral-subtle-default',
  'aria-expanded:!bg-ds-bg-neutral-subtle-default',
  'aria-pressed:!bg-ds-bg-neutral-subtle-default',
].join(' ');

/** Selected/open fill for a control that tracks its state in React. */
export const TOP_BAR_CONTROL_SELECTED_CLASS =
  '!bg-ds-bg-neutral-subtle-default';

/**
 * The labelled pill in the title bar's leading slot — Home, the Space
 * switcher, and the Home/Settings back button all render identically.
 *
 * The type scale is forced (`!text-label-sm`): these are bare `<button>`
 * elements and Tailwind's preflight is disabled, so the browser's own control
 * font would otherwise size the label.
 */
export const TOP_BAR_PILL_CLASS = [
  'no-drag flex min-h-[28px] min-w-0 items-center gap-1.5 rounded-full px-2',
  '!text-label-sm font-bold text-ds-text-neutral-default-default',
  'outline-none transition-colors',
  'focus-visible:ring-ds-ring-brand-default-focus/50 focus-visible:ring-[3px]',
  TOP_BAR_CONTROL_STATE_CLASS,
].join(' ');
