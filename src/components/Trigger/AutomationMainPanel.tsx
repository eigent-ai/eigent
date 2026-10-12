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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsText } from '@/components/ui/ds-text';
import { Switch } from '@/components/ui/switch';
import { Trigger, TriggerStatus } from '@/types';
import { ChevronLeft, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type AutomationMainPanelProps = {
  trigger: Trigger | null;
  onBack: () => void;
  onEdit: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void | Promise<void>;
  isBusy?: boolean;
  children: ReactNode;
};

export function AutomationMainPanel({
  trigger,
  onBack,
  onEdit,
  onDelete,
  onToggleActive,
  isBusy = false,
  children,
}: AutomationMainPanelProps) {
  const { t } = useTranslation();
  const isActive = trigger?.status === TriggerStatus.Active;
  const needsAuth =
    trigger?.status === TriggerStatus.PendingAuth &&
    trigger.config?.authentication_required;

  return (
    <section
      aria-label={
        trigger ? t('triggers.trigger-details') : t('triggers.try-an-example')
      }
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <ContentHeader
        border={false}
        inset="none"
        className="pr-ds-16 pl-ds-6"
        leading={
          trigger && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={onBack}
            >
              <ChevronLeft aria-hidden />
              {t('triggers.title')}
            </Button>
          )
        }
        actions={
          trigger && (
            <div className="flex items-center gap-ds-8">
              <DsText
                as="span"
                role="base"
                className="text-ds-ink-muted-default"
              >
                {needsAuth
                  ? t('triggers.verification-required')
                  : isActive
                    ? t('triggers.status.active')
                    : t('triggers.paused')}
              </DsText>
              <Switch
                variant="outline"
                checked={isActive}
                disabled={isBusy || !!needsAuth}
                onCheckedChange={() => void onToggleActive(trigger)}
                // The name stays put; `checked` announces on or off.
                aria-label={trigger.name}
              />
            </div>
          )
        }
      >
        {trigger && (
          <div className="flex min-w-0 items-center gap-ds-6">
            <DsText
              as="span"
              role="base"
              aria-hidden
              className="mr-[calc(var(--ds-button-sm-padding-inline)+var(--ds-border-thin))] shrink-0 text-ds-ink-subtle-default"
            >
              /
            </DsText>
            <DsText
              as="span"
              role="base"
              weight="medium"
              className="truncate !leading-[var(--ds-button-sm-line-height)]"
              title={trigger.name}
            >
              {trigger.name}
            </DsText>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  className="shrink-0"
                  aria-label={t('triggers.more-actions-named', {
                    name: trigger.name,
                  })}
                >
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  disabled={isBusy}
                  onSelect={() => onEdit(trigger)}
                >
                  <Pencil aria-hidden />
                  {t('triggers.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isBusy}
                  className="text-ds-text-error-default-default focus:text-ds-text-error-strong-default"
                  onSelect={() => onDelete(trigger)}
                >
                  <Trash2 aria-hidden />
                  {t('triggers.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </ContentHeader>
      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto px-ds-24 xl:px-ds-page-gutter">
        {children}
      </div>
    </section>
  );
}
