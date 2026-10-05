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

import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { cn } from '@/lib/utils';
import { useAutomationProfileStore } from '@/store/automationProfileStore';
import { Check, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getExamplesForRole,
  type AutomationExample,
} from './automationExampleData';
import { formatScheduleLabel } from './automationSchedule';

type AutomationExamplesProps = {
  onSelectExample: (example: AutomationExample) => void;
  /** Role label to confirm right after the user saves a role. */
  savedRoleLabel?: string | null;
};

export function AutomationExamples({
  onSelectExample,
  savedRoleLabel,
}: AutomationExamplesProps) {
  const { t, i18n } = useTranslation();
  const role = useAutomationProfileStore((state) => state.role);
  const examples = getExamplesForRole(role);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-ds-16 py-ds-24">
      <div className="flex flex-col items-center gap-ds-6 text-center">
        <DsText as="h2" role="body-large" weight="semibold">
          {t('triggers.try-an-example')}
        </DsText>
        {savedRoleLabel && (
          <DsText
            as="p"
            role="meta"
            weight="semibold"
            aria-live="polite"
            className="flex items-center gap-ds-4 text-ds-text-success-strong-default"
          >
            <DsIcon icon={Check} recipe="main-compact" aria-hidden />
            {t('triggers.profile-saved', { role: savedRoleLabel })}
          </DsText>
        )}
      </div>
      <ul className="grid list-none grid-cols-1 gap-ds-12 p-0 sm:grid-cols-2">
        {examples.map((example) => {
          const title = t(`triggers.examples.${example.id}.title`);
          const description = t(`triggers.examples.${example.id}.description`);
          const schedule = formatScheduleLabel(
            example.schedule,
            t,
            i18n.language
          );
          return (
            <li key={example.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onSelectExample(example)}
                aria-label={t('triggers.example-card-label', {
                  title,
                  description,
                  schedule,
                })}
                className={cn(
                  'flex h-full w-full min-w-0 cursor-pointer flex-col gap-ds-4 rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default p-ds-16 text-left transition-[border-color,box-shadow] duration-150 hover:border-ds-hairline-strong-default hover:shadow-ds-elevation-card motion-reduce:transition-none',
                  DS_FOCUS_RING
                )}
              >
                <DsText as="span" role="body-large" weight="semibold">
                  {title}
                </DsText>
                <DsText
                  as="span"
                  role="base"
                  className="flex-1 text-ds-ink-muted-default"
                >
                  {description}
                </DsText>
                <DsText
                  as="span"
                  role="meta"
                  className="mt-ds-8 flex items-center gap-ds-4 text-ds-ink-muted-default"
                >
                  <DsIcon icon={Clock} recipe="main-compact" aria-hidden />
                  {schedule}
                </DsText>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
