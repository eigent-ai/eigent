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

import tokenDarkIcon from '@/assets/token-dark.svg';
import tokenLightIcon from '@/assets/token-light.svg';
import { AnimatedTokenNumber } from '@/components/ChatBox/MessageItem/TokenUtils';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface HeaderBoxProps {
  /** Total token count for the current project */
  totalTokens?: number;
  /** Optional extra class names for the outer container */
  className?: string;
}

export function HeaderBox({ totalTokens = 0, className }: HeaderBoxProps) {
  const { t } = useTranslation();
  const { appearance } = useAuthStore();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const tokenIcon = appearance === 'dark' ? tokenDarkIcon : tokenLightIcon;
  const backToWorkspaceTooltip = t('layout.back-to-workspace-tooltip', {
    defaultValue: 'Back to workspace',
  });

  return (
    <div
      className={`px-3 flex h-[44px] w-full flex-row items-center justify-between ${className || ''}`}
    >
      {/* Left: return to project workspace */}
      <div className="gap-2 flex items-center">
        <TooltipSimple content={backToWorkspaceTooltip}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={() => setActiveWorkspaceTab('workforce')}
            className="no-drag text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-strong-default shrink-0"
            aria-label={backToWorkspaceTooltip}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Button>
        </TooltipSimple>
      </div>

      {/* Right: project total token count */}
      <div className="gap-2 text-ds-text-neutral-muted-default flex items-center">
        <div className="gap-1 flex items-center">
          <img src={tokenIcon} alt="" className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">
            {t('chat.token-total-label')}{' '}
            <AnimatedTokenNumber value={totalTokens} />
          </span>
        </div>
      </div>
    </div>
  );
}
