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

import { SidePanelAccordionBox } from '@/components/Session/SidePanelAccordionBox';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import ExpandedOverlay from '@/components/Workforce/ExpandedOverlay';
import { cn } from '@/lib/utils';
import { Maximize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const WORKFORCE_MAIN_SURFACE_CLASS =
  'min-w-0 flex h-full w-full flex-col overflow-hidden';

export interface WorkforceSidePanelProps {
  workforcePanelKey: string;
  hasAnyMessages: boolean;
  isSidePanelVisible: boolean;
  onToggleSidePanel: () => void;
  /** Controlled: whether the full-screen workforce overlay is open. */
  isExpandedOverlayOpen: boolean;
  onToggleExpandedOverlay: () => void;
  onCloseExpandedOverlay: () => void;
}

export function WorkforceSidePanel({
  workforcePanelKey,
  hasAnyMessages: _hasAnyMessages,
  isSidePanelVisible,
  onToggleSidePanel,
  isExpandedOverlayOpen,
  onToggleExpandedOverlay,
  onCloseExpandedOverlay,
}: WorkforceSidePanelProps) {
  const { t } = useTranslation();

  return (
    <>
      {isSidePanelVisible && (
        <div className={cn(WORKFORCE_MAIN_SURFACE_CLASS, 'relative')}>
          <div className="gap-2 p-2 relative z-50 flex w-full shrink-0 items-center justify-between">
            <span className="text-ds-text-neutral-default-default px-1 text-body-md font-semibold truncate">
              {t('layout.aiWorkforce')}
            </span>
            <div className="gap-1 flex shrink-0 items-center">
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
            </div>
          </div>

          <div className="gap-2 px-2 pb-2 min-h-0 min-w-0 flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
            <SidePanelAccordionBox
              title={t('layout.workforce-active-agent-pool', {
                defaultValue: 'Active Agent Pool',
              })}
            >
              <ul className="text-ds-text-neutral-muted-default text-body-sm space-y-1.5 p-0 m-0 list-none">
                <li className="text-ds-text-neutral-muted-default px-1 py-1">
                  {t('layout.workforce-empty-list', {
                    defaultValue: 'No items yet',
                  })}
                </li>
              </ul>
            </SidePanelAccordionBox>

            <SidePanelAccordionBox
              title={t('layout.workforce-progress', {
                defaultValue: 'Progress',
              })}
            >
              <ul className="text-ds-text-neutral-muted-default text-body-sm space-y-1.5 p-0 m-0 list-none">
                <li className="text-ds-text-neutral-muted-default px-1 py-1">
                  {t('layout.workforce-empty-list', {
                    defaultValue: 'No items yet',
                  })}
                </li>
              </ul>
            </SidePanelAccordionBox>

            <SidePanelAccordionBox
              title={t('layout.workforce-context', {
                defaultValue: 'Context',
              })}
            >
              <ul className="text-ds-text-neutral-muted-default text-body-sm space-y-1.5 p-0 m-0 list-none">
                <li className="text-ds-text-neutral-muted-default px-1 py-1">
                  {t('layout.workforce-empty-list', {
                    defaultValue: 'No items yet',
                  })}
                </li>
              </ul>
            </SidePanelAccordionBox>

            <SidePanelAccordionBox
              title={t('layout.workforce-agent-folder', {
                defaultValue: 'Agent Folder',
              })}
            >
              <ul className="text-ds-text-neutral-muted-default text-body-sm space-y-1.5 p-0 m-0 list-none">
                <li className="text-ds-text-neutral-muted-default px-1 py-1">
                  {t('layout.workforce-empty-list', {
                    defaultValue: 'No items yet',
                  })}
                </li>
              </ul>
            </SidePanelAccordionBox>
          </div>
        </div>
      )}

      <ExpandedOverlay
        open={isExpandedOverlayOpen}
        onClose={onCloseExpandedOverlay}
        workforcePanelKey={workforcePanelKey}
        onToggleSidePanel={onToggleSidePanel}
        isSidePanelVisible={isSidePanelVisible}
      />
    </>
  );
}
