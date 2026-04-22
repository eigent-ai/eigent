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
import { Maximize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface WorkforceSidePanelHeaderEndProps {
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
}

export function WorkforceSidePanelHeaderEnd({
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
}: WorkforceSidePanelHeaderEndProps) {
  const { t } = useTranslation();
  return (
    <TooltipSimple
      content={
        isExpandedOverlayOpen
          ? t('layout.close')
          : t('layout.expand-workforce', {
              defaultValue: 'Expand workforce',
            })
      }
      delayDuration={300}
      side="bottom"
    >
      <Button
        variant="ghost"
        size="sm"
        buttonContent="icon-only"
        buttonRadius="lg"
        className="shrink-0"
        onClick={onToggleExpandedOverlay}
        aria-pressed={isExpandedOverlayOpen}
        aria-label={
          isExpandedOverlayOpen
            ? t('layout.close')
            : t('layout.expand-workforce', {
                defaultValue: 'Expand workforce',
              })
        }
      >
        {isExpandedOverlayOpen ? (
          <X className="h-4 w-4" />
        ) : (
          <Maximize2 className="h-4 w-4" />
        )}
      </Button>
    </TooltipSimple>
  );
}
