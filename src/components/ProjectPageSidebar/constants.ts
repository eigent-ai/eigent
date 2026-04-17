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

import type { Transition } from 'framer-motion';

/** Keep in sync with `HOME_MAIN_LAYOUT_SPRING` in `pages/Home.tsx`. */
export const PROJECT_SIDEBAR_FOLD_SPRING: Transition = {
  type: 'spring',
  stiffness: 380,
  damping: 38,
  mass: 0.85,
};

/**
 * Icon rail width: `px-3` horizontal padding (12+12) + 16px icon = 40px.
 * Matches workspace tab leading column (`NavTab` / `workspaceTabButtonClass`).
 */
export const PROJECT_SIDEBAR_RAIL_WIDTH_PX = 40;
