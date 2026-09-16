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

import { SidePanelFoldButton } from '@/components/Session/SidePanel/components/FoldButton';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import type { SessionModeType } from '@/types/constants';
import { LoaderCircle, RotateCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Consumes the shared Session runtime; never starts another history loader. */
export function SessionHistoryAction() {
  const { t } = useTranslation();
  const { hydration, projectId } = useProjectEventRuntime();
  const pending =
    hydration.status === 'loading' || hydration.status === 'retrying';
  if (!projectId || (!pending && hydration.status !== 'error')) return null;

  const statusLabel = pending
    ? t(
        hydration.status === 'retrying'
          ? 'chat.timeline-history-reconnecting'
          : 'chat.timeline-history-loading'
      )
    : t(
        hydration.errorCode === 'unsupported'
          ? 'layout.session-panel-history-unsupported'
          : 'layout.session-panel-history-unavailable'
      );
  const label = pending
    ? statusLabel
    : `${statusLabel} ${t('chat.timeline-history-retry')}`;

  return (
    <TooltipSimple content={label} side="bottom">
      <span className="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          buttonContent="icon-only"
          aria-label={label}
          aria-busy={pending}
          disabled={pending}
          onClick={hydration.retry}
        >
          {pending ? (
            <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
          ) : (
            <RotateCw aria-hidden />
          )}
        </Button>
        <span className="sr-only" role="status">
          {statusLabel}
        </span>
      </span>
    </TooltipSimple>
  );
}

export interface SidePanelHeaderProps {
  title: string;
  mode: SessionModeType;
  isSidePanelVisible: boolean;
  onToggle: () => void;
  /** Optional right-side content (e.g. workforce expand overlay) */
  end?: ReactNode;
}

export function SidePanelHeader({
  title,
  mode,
  isSidePanelVisible,
  onToggle,
  end,
}: SidePanelHeaderProps) {
  return (
    <div className="relative z-50 flex h-ds-layout-row-header min-h-ds-layout-row-header w-full min-w-0 shrink-0 items-center overflow-visible px-ds-8">
      <div className="flex min-w-0 flex-1 items-center justify-start gap-1">
        <SidePanelFoldButton
          sessionSidePanelMode={mode}
          isSidePanelVisible={isSidePanelVisible}
          onToggle={onToggle}
        />
        <span className="max-w-full min-w-0 truncate text-center text-ds-text-body-large font-semibold text-ds-ink-default-default">
          {title}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        {end != null ? (
          <div className="flex items-center gap-1">{end}</div>
        ) : null}
      </div>
    </div>
  );
}
