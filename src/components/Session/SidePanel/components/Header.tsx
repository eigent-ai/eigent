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

import ContentHeader from '@/components/Layout/ContentHeader';
import type { SessionPanelScope } from '@/components/Session/SidePanel/sections/sessionPanelScope';
import { TOP_BAR_CONTROL_STATE_CLASS } from '@/components/TopBar/controlStyles';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsText } from '@/components/ui/ds-text';
import { Separator } from '@/components/ui/separator';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import { cn } from '@/lib/utils';
import { Check, ChevronDown, LoaderCircle, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const SCOPES = [
  'latest',
  'all',
] as const satisfies readonly SessionPanelScope[];
/** Hidden at rest on hover devices; shown on card hover/focus or while open. */
const SCOPE_TRIGGER_REVEAL_CLASS =
  'pointer-events-none opacity-0 transition-opacity group-focus-within/activity-section:pointer-events-auto group-focus-within/activity-section:opacity-100 group-hover/activity-section:pointer-events-auto group-hover/activity-section:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100';

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

/**
 * Activity title row with the history retry and Summary scope menu. The scope
 * menu reveals on hover/focus of the enclosing `group/activity-section` card.
 */
export function ActivityHeader({
  scope,
  onScopeChange,
}: {
  scope: SessionPanelScope;
  onScopeChange: (scope: SessionPanelScope) => void;
}) {
  const { t } = useTranslation();
  const title = t('layout.session-panel-activity', {
    defaultValue: 'Activity',
  });
  const scopeLabel = t('layout.session-summary-scope', {
    defaultValue: 'Summary content',
  });
  const scopeLabels: Record<SessionPanelScope, string> = {
    latest: t('layout.session-summary-latest-only', {
      defaultValue: 'Latest only',
    }),
    all: t('layout.session-summary-all', { defaultValue: 'All' }),
  };

  return (
    <>
      <ContentHeader
        inset="none"
        className="mb-ds-4 pr-ds-2 pl-ds-8"
        titleAsChild
        title={
          <DsText
            as="span"
            role="base"
            weight="semibold"
            className="min-w-0 truncate text-ds-ink-default-default"
          >
            {title}
          </DsText>
        }
        border={false}
        actions={
          <>
            <SessionHistoryAction />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={scopeLabel}
                  className={cn(
                    TOP_BAR_CONTROL_STATE_CLASS,
                    SCOPE_TRIGGER_REVEAL_CLASS
                  )}
                >
                  {scopeLabels[scope]}
                  <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8}>
                <DropdownMenuGroup aria-label={scopeLabel}>
                  {SCOPES.map((value) => (
                    <DropdownMenuItem
                      key={value}
                      role="menuitemradio"
                      aria-checked={scope === value}
                      onSelect={() => onScopeChange(value)}
                    >
                      <span className="min-w-0 flex-1">
                        {scopeLabels[value]}
                      </span>
                      {scope === value ? (
                        <Check
                          className="text-ds-accent-default-default"
                          aria-hidden
                        />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <Separator decorative={false} className="bg-ds-hairline-subtle-default" />
    </>
  );
}
