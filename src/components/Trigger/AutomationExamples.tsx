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
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AUTOMATION_EXAMPLES,
  type AutomationExample,
} from './automationExampleData';
import { formatScheduleLabel } from './automationSchedule';

type AutomationExamplesProps = {
  onSelectExample: (example: AutomationExample) => void;
};

export function AutomationExamples({
  onSelectExample,
}: AutomationExamplesProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-ds-24 py-ds-24">
      <div className="flex flex-col items-center gap-ds-8 text-center">
        <DsText as="h1" role="page" weight="semibold">
          {t('triggers.examples-heading')}
        </DsText>
        <DsText as="p" role="body-large" className="text-ds-ink-muted-default">
          {t('triggers.examples-subtitle')}
        </DsText>
      </div>
      <ul className="grid list-none grid-cols-1 gap-ds-24 p-0 sm:grid-cols-2">
        {AUTOMATION_EXAMPLES.map((example) => {
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
                  'flex h-full w-full min-w-0 cursor-pointer flex-col gap-ds-4 rounded-ds-card border border-x border-y border-solid border-transparent bg-ds-neutral-default-default p-ds-16 text-left transition-[border-color] duration-150 hover:border-ds-hairline-strong-default motion-reduce:transition-none',
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
