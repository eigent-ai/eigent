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

import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { SessionModeType } from '@/types/constants';
import { PanelRight, PanelRightClose } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SessionSidePanelFoldButtonProps {
  sessionSidePanelMode: SessionModeType;
  isSidePanelVisible: boolean;
  onToggle: () => void;
  className?: string;
}

export function SessionSidePanelFoldButton({
  sessionSidePanelMode,
  isSidePanelVisible,
  onToggle,
  className,
}: SessionSidePanelFoldButtonProps) {
  const { t } = useTranslation();
  const sessionSidePanelTooltip =
    sessionSidePanelMode === 'single-agent'
      ? isSidePanelVisible
        ? t('layout.hide-side-panel', {
            defaultValue: 'Hide side panel',
          })
        : t('layout.show-side-panel', {
            defaultValue: 'Show side panel',
          })
      : isSidePanelVisible
        ? t('layout.hide-workforce-panel', {
            defaultValue: 'Hide workforce panel',
          })
        : t('layout.show-workforce-panel');

  return (
    <TooltipSimple content={sessionSidePanelTooltip}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        buttonContent="icon-only"
        onClick={onToggle}
        aria-expanded={isSidePanelVisible}
        aria-controls="session-side-panel"
        className={cn(
          'no-drag text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default shrink-0',
          className
        )}
        aria-label={sessionSidePanelTooltip}
      >
        {isSidePanelVisible ? (
          <PanelRightClose className="h-4 w-4" aria-hidden />
        ) : (
          <PanelRight className="h-4 w-4" aria-hidden />
        )}
      </Button>
    </TooltipSimple>
  );
}
