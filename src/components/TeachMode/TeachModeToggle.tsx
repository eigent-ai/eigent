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

import { TOP_BAR_PILL_BASE_CLASS } from '@/components/TopBar/controlStyles';
import { DsIcon } from '@/components/ui/ds-icon';
import { useTeachModeStore } from '@/store/teachModeStore';
import { GraduationCap, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function TeachModeToggle() {
  const { t } = useTranslation();
  const enabled = useTeachModeStore((state) => state.enabled);
  const setEnabled = useTeachModeStore((state) => state.setEnabled);
  const label = t('layout.teach-mode', { defaultValue: 'Teach mode' });
  const disableLabel = t('layout.teach-mode-disable', {
    defaultValue: 'Turn off',
  });

  if (!enabled) return null;

  return (
    <button
      type="button"
      className={`${TOP_BAR_PILL_BASE_CLASS} group shrink-0 bg-ds-bg-teach-mode-default-default !text-ds-ink-inverse hover:bg-ds-bg-teach-mode-default-hover active:shadow-ds-elevation-control-pressed`}
      onClick={() => setEnabled(false)}
      aria-label={`${disableLabel} ${label}`}
      data-teach-mode-indicator="active"
    >
      <span className="relative grid size-ds-icon-md shrink-0 place-items-center">
        <DsIcon
          icon={GraduationCap}
          recipe="main"
          className="absolute group-hover:opacity-0 group-focus-visible:opacity-0"
        />
        <DsIcon
          icon={X}
          recipe="main"
          className="absolute opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      </span>
      <span>{label}</span>
    </button>
  );
}
