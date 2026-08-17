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

import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Router state key used by every entry into Home / Settings, so those pages can
 * send the user back where they came from instead of always to the workspace.
 */
export const SHELL_BACK_STATE_KEY = 'from';

/** Build the `state` payload for a navigation into a full-page shell surface. */
export function shellBackState(from: string): { from: string } {
  return { [SHELL_BACK_STATE_KEY]: from };
}

export interface ShellBackTarget {
  /** Path (with query) the back control returns to. */
  to: string;
  /** Localized "Back to <page>" label. */
  label: string;
  goBack: () => void;
}

/**
 * Resolve the back destination for a shell page: the location the user came
 * from when it was recorded, otherwise `fallbackTo` (the workspace).
 */
export function useShellBackTarget(fallbackTo = '/'): ShellBackTarget {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const state = location.state as Record<string, unknown> | null;
  const from = state?.[SHELL_BACK_STATE_KEY];
  const hasRecordedOrigin = typeof from === 'string' && Boolean(from);
  const to = hasRecordedOrigin ? from : fallbackTo;

  const label = useMemo(() => {
    const target = to.startsWith('/home')
      ? t('layout.home')
      : to.startsWith('/settings')
        ? t('layout.settings')
        : t('layout.workspace-tab');
    return t('layout.back-to', { target, defaultValue: `Back to ${target}` });
  }, [t, to]);

  const goBack = useCallback(() => {
    if (hasRecordedOrigin) {
      navigate(-1);
      return;
    }

    navigate(fallbackTo, { replace: true });
  }, [fallbackTo, hasRecordedOrigin, navigate]);

  return { to, label, goBack };
}
