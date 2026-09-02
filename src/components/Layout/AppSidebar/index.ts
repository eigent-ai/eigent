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
 * Reusable app-sidebar kit. Every page rail in the layout (workspace, home,
 * settings) is composed from these primitives so rows, spacing and motion stay
 * identical across pages.
 */
export {
  SIDEBAR_FOLD_SPRING,
  SIDEBAR_TOOLTIP_CONTENT_CLASS,
} from './constants';
export {
  NavTab,
  SIDEBAR_TAB_LABEL_CLASS,
  sidebarTabButtonClass,
  type NavTabLayout,
  type NavTabProps,
} from './NavTab';
export { SidebarBackHeader } from './SidebarBackHeader';
export {
  SidebarScrollArea,
  type SidebarScrollAreaProps,
} from './SidebarScrollArea';
export {
  SidebarNavGroup,
  SidebarSection,
  SidebarSeparator,
  SidebarShell,
  type SidebarNavGroupProps,
  type SidebarSectionProps,
  type SidebarShellProps,
} from './SidebarShell';
