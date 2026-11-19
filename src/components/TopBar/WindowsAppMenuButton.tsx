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

import { TOP_BAR_CONTROL_STATE_CLASS } from '@/components/TopBar/controlStyles';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import type { AppShellElectronAPI } from '@/host/types';
import { cn } from '@/lib/utils';
import { hasWindowAppMenuButton } from '@/shared/windowChrome';
import { Menu as MenuIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface WindowsAppMenuButtonProps {
  platform: string;
}

/**
 * Windows draws its caption buttons inside the app header, which hides the
 * native menu bar. This button opens the same application menu (File, Edit,
 * View, Window, Help) as a dropdown anchored under itself.
 */
export function WindowsAppMenuButton({ platform }: WindowsAppMenuButtonProps) {
  const { t } = useTranslation();
  const host = useHost();
  const electronAPI = host?.electronAPI as AppShellElectronAPI | undefined;
  const openWindowAppMenu = electronAPI?.openWindowAppMenu;

  if (!hasWindowAppMenuButton(platform) || !openWindowAppMenu) return null;

  const label = t('layout.app-menu', { defaultValue: 'Application menu' });

  return (
    <TooltipSimple
      content={label}
      compact
      side="bottom"
      align="center"
      variant="instant"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        buttonContent="icon-only"
        buttonRadius="shell"
        className={cn('no-drag', TOP_BAR_CONTROL_STATE_CLASS)}
        aria-label={label}
        aria-haspopup="menu"
        data-testid="windows-app-menu-button"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openWindowAppMenu({
            x: Math.max(0, rect.left),
            y: Math.max(0, rect.bottom),
          });
        }}
      >
        <DsIcon icon={MenuIcon} aria-hidden />
      </Button>
    </TooltipSimple>
  );
}
