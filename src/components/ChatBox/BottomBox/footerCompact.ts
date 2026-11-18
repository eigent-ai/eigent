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

import { createContext, useContext } from 'react';

/**
 * True while the composer footer is narrow. Controls passed into the footer
 * from outside (for example New session's Space chip) read it so they collapse
 * to icon-only together with the built-in mode and approval controls.
 */
export const FooterCompactContext = createContext(false);

export function useFooterCompact(): boolean {
  return useContext(FooterCompactContext);
}

/**
 * Narrow-footer trigger geometry: an even 4px inset around the 16px icon gives
 * a 24 × 24px circular icon button in place of the labelled pill.
 */
export const FOOTER_COMPACT_TRIGGER_CLASS = 'p-1';
