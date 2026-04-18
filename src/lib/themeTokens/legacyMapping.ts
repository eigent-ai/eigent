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

import { tokenKeyToCssVarValue } from './naming';
import type { TokenKey } from './types';

export type LegacyTokenMappingEntry = {
  legacyVariable: string;
  token: TokenKey;
  notes?: string;
};

export const LEGACY_TOKEN_MAPPING: LegacyTokenMappingEntry[] = [
  // Task/badge lifecycle semantics
  {
    legacyVariable: '--badge-running-surface',
    token: 'bg.status-running.subtle.default',
  },
  {
    legacyVariable: '--badge-running-surface-foreground',
    token: 'text.status-running.strong.default',
  },
  {
    legacyVariable: '--badge-splitting-surface',
    token: 'bg.status-splitting.subtle.default',
  },
  {
    legacyVariable: '--badge-splitting-surface-foreground',
    token: 'text.status-splitting.strong.default',
  },
  {
    legacyVariable: '--badge-paused-surface',
    token: 'bg.status-paused.subtle.default',
  },
  {
    legacyVariable: '--badge-paused-surface-foreground',
    token: 'text.status-paused.strong.default',
  },
  {
    legacyVariable: '--badge-error-surface',
    token: 'bg.status-error.subtle.default',
  },
  {
    legacyVariable: '--badge-error-surface-foreground',
    token: 'text.status-error.strong.default',
  },
  {
    legacyVariable: '--badge-complete-surface',
    token: 'bg.status-completed.subtle.default',
  },
  {
    legacyVariable: '--badge-complete-surface-foreground',
    token: 'text.status-completed.strong.default',
  },
  {
    legacyVariable: '--task-fill-running',
    token: 'bg.status-running.subtle.default',
  },
  {
    legacyVariable: '--task-fill-success',
    token: 'bg.status-completed.subtle.default',
  },
  {
    legacyVariable: '--task-fill-warning',
    token: 'bg.status-blocked.subtle.default',
    notes:
      'In task cards this often also represents reassigning, which should migrate to status-reassigning.',
  },
  {
    legacyVariable: '--task-fill-error',
    token: 'bg.status-error.subtle.default',
  },
  {
    legacyVariable: '--task-border-focus-success',
    token: 'border.status-completed.default.focus',
  },
  {
    legacyVariable: '--task-border-focus-warning',
    token: 'border.status-blocked.default.focus',
  },
  {
    legacyVariable: '--task-border-focus-error',
    token: 'border.status-error.default.focus',
  },

  // Generic semantic colors currently used in status-like UI contexts
  {
    legacyVariable: '--surface-success',
    token: 'bg.status-completed.subtle.default',
  },
  {
    legacyVariable: '--surface-information',
    token: 'bg.status-splitting.subtle.default',
  },
  {
    legacyVariable: '--surface-warning',
    token: 'bg.status-pending.subtle.default',
  },
  {
    legacyVariable: '--surface-cuation',
    token: 'bg.status-error.subtle.default',
    notes:
      'Spelling kept for legacy compatibility. New naming should use error.',
  },
  {
    legacyVariable: '--text-success',
    token: 'text.status-completed.strong.default',
  },
  {
    legacyVariable: '--text-information',
    token: 'text.status-splitting.strong.default',
  },
  {
    legacyVariable: '--text-warning',
    token: 'text.status-pending.strong.default',
  },
  {
    legacyVariable: '--text-cuation',
    token: 'text.status-error.strong.default',
  },
  {
    legacyVariable: '--border-success',
    token: 'border.status-completed.default.default',
  },
  {
    legacyVariable: '--border-information',
    token: 'border.status-splitting.default.default',
  },
  {
    legacyVariable: '--border-warning',
    token: 'border.status-pending.default.default',
  },
  {
    legacyVariable: '--border-cuation',
    token: 'border.status-error.default.default',
  },
  {
    legacyVariable: '--icon-success',
    token: 'icon.status-completed.default.default',
  },
  {
    legacyVariable: '--icon-information',
    token: 'icon.status-splitting.default.default',
  },
  {
    legacyVariable: '--icon-warning',
    token: 'icon.status-pending.default.default',
  },
  {
    legacyVariable: '--icon-cuation',
    token: 'icon.status-error.default.default',
  },
];

export function buildLegacyAliasVariableValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of LEGACY_TOKEN_MAPPING) {
    out[item.legacyVariable] = tokenKeyToCssVarValue(item.token);
  }
  return out;
}
