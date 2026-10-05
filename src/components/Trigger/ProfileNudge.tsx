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
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { cn } from '@/lib/utils';
import { useAutomationProfileStore } from '@/store/automationProfileStore';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AUTOMATION_ROLE_ICONS,
  AUTOMATION_ROLE_IDS,
  type AutomationRoleId,
} from './automationExampleData';

const SHOW_DELAY_MS = 1000;

type ProfileNudgeProps = {
  onRoleSaved: (role: AutomationRoleId) => void;
};

export function ProfileNudge({ onRoleSaved }: ProfileNudgeProps) {
  const { t } = useTranslation();
  const role = useAutomationProfileStore((state) => state.role);
  const dismissed = useAutomationProfileStore((state) => state.nudgeDismissed);
  const setRole = useAutomationProfileStore((state) => state.setRole);
  const dismissNudge = useAutomationProfileStore((state) => state.dismissNudge);
  const [ready, setReady] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (role || dismissed || !ready) return null;

  const titleId = 'automation-profile-nudge-title';

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed right-ds-20 bottom-ds-20 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-ds-12 rounded-ds-popover border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default p-ds-16 shadow-ds-elevation-popover"
    >
      <div className="flex items-start gap-ds-8">
        <div className="flex min-w-0 flex-1 flex-col gap-ds-2">
          <DsText as="h2" id={titleId} role="body-large" weight="semibold">
            {picking
              ? t('triggers.profile-nudge-picker-title')
              : t('triggers.profile-nudge-title')}
          </DsText>
          <DsText as="p" role="base" className="text-ds-ink-muted-default">
            {picking
              ? t('triggers.profile-nudge-picker-body')
              : t('triggers.profile-nudge-body')}
          </DsText>
        </div>
        <Button
          variant="ghost"
          size="xs"
          buttonContent="icon-only"
          aria-label={t('triggers.close')}
          onClick={dismissNudge}
        >
          <X aria-hidden />
        </Button>
      </div>

      {picking ? (
        <ul className="scrollbar-always-visible grid max-h-56 list-none grid-cols-3 gap-ds-6 overflow-y-auto p-0">
          {AUTOMATION_ROLE_IDS.map((roleId) => (
            <li key={roleId}>
              <button
                type="button"
                onClick={() => {
                  setRole(roleId);
                  onRoleSaved(roleId);
                }}
                className={cn(
                  'flex h-full w-full cursor-pointer flex-col items-center gap-ds-4 rounded-ds-compact-control border border-x border-y border-solid border-transparent bg-ds-neutral-default-default px-ds-4 py-ds-8 text-center text-ds-ink-muted-default transition-colors duration-150 hover:bg-ds-neutral-strong-default hover:text-ds-ink-default-default motion-reduce:transition-none',
                  DS_FOCUS_RING
                )}
              >
                <DsIcon
                  icon={AUTOMATION_ROLE_ICONS[roleId]}
                  recipe="main"
                  aria-hidden
                />
                <DsText as="span" role="meta">
                  {t(`triggers.roles.${roleId}`)}
                </DsText>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <Button variant="primary" size="sm" onClick={() => setPicking(true)}>
            {t('triggers.profile-nudge-action')}
          </Button>
        </div>
      )}
    </section>
  );
}
