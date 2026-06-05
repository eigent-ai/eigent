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

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ONBOARDING_KEY = 'eigent-workspace-onboarding-checked';

const ONBOARDING_STEP_IDS = [1, 2, 3, 4] as const;
const LAST_ONBOARDING_STEP_ID =
  ONBOARDING_STEP_IDS[ONBOARDING_STEP_IDS.length - 1];

function readCheckedSteps(): Set<number> {
  try {
    const v = localStorage.getItem(ONBOARDING_KEY);
    return v ? new Set(JSON.parse(v) as number[]) : new Set();
  } catch {
    return new Set();
  }
}

interface StepCardProps {
  id: number;
  title: string;
  subtitle: string;
  checked: boolean;
  onClick: () => void;
}

function StepCard({ id, title, subtitle, checked, onClick }: StepCardProps) {
  return (
    <button
      type="button"
      className={cn(
        'group flex w-full items-start gap-2 rounded-xl bg-ds-bg-neutral-subtle-default p-2 text-left transition-colors',
        checked
          ? 'cursor-default'
          : 'cursor-pointer hover:bg-ds-bg-neutral-strong-default'
      )}
      onClick={checked ? undefined : onClick}
      aria-pressed={checked}
    >
      {/* Circle */}
      <div
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
          checked
            ? 'bg-ds-bg-success-default-default'
            : 'bg-ds-bg-neutral-muted-default'
        )}
      >
        {checked ? (
          <Check
            className="h-2.5 w-2.5 !text-ds-text-success-inverse-default"
            aria-hidden
          />
        ) : (
          <span className="text-[8px] font-bold leading-none text-ds-text-neutral-muted-default">
            {id}
          </span>
        )}
      </div>

      {/* Text */}
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            '!text-body-sm font-semibold',
            checked
              ? 'text-ds-text-neutral-muted-default'
              : 'text-ds-text-neutral-default-default'
          )}
        >
          {title}
        </span>
        <span className="mt-1 text-label-xs text-ds-text-neutral-muted-default">
          {subtitle}
        </span>
      </div>
    </button>
  );
}

export interface WorkspaceCoworkPanelProps {
  memoryOn: boolean;
  onMemoryToggle: () => void;
}

export function WorkspaceCoworkPanel({
  memoryOn,
  onMemoryToggle,
}: WorkspaceCoworkPanelProps) {
  const { t } = useTranslation();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const [checkedSteps, setCheckedSteps] =
    useState<Set<number>>(readCheckedSteps);
  const [accordionOpen, setAccordionOpen] = useState<string | undefined>(
    undefined
  );

  const onboardingSteps = ONBOARDING_STEP_IDS.map((id) => ({
    id,
    title: t(`layout.onboarding-step-${id}-title`),
    subtitle: t(`layout.onboarding-step-${id}-subtitle`),
  }));

  const allChecked = checkedSteps.size >= onboardingSteps.length;

  useEffect(() => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify([...checkedSteps]));
  }, [checkedSteps]);

  const handleCheckStep = (id: number) => {
    const isFirstCompletion =
      id === LAST_ONBOARDING_STEP_ID &&
      checkedSteps.size === ONBOARDING_STEP_IDS.length - 1 &&
      !checkedSteps.has(id);

    setCheckedSteps((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

    if (isFirstCompletion) {
      setActiveWorkspaceTab('triggers');
    }
  };

  const instructionsTitle = t('layout.instructions');
  const memoryLabel = t('layout.memory');
  const memoryOnLabel = t('layout.memory-on');
  const memoryOffLabel = t('layout.memory-off');
  const gettingStartedLabel = t('layout.getting-started');

  return (
    <div className="flex h-full flex-col overflow-hidden py-1 pr-1">
      {/* Settings area */}
      <div className="flex shrink-0 flex-col gap-0.5 rounded-2xl bg-ds-bg-neutral-default-default px-2 py-1">
        {/* Panel title */}
        <div className="shrink-0 px-2 py-1.5">
          <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
            {instructionsTitle}
          </span>
        </div>
        <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-ds-bg-neutral-strong-default">
          <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default">
            {memoryLabel}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="no-drag shrink-0"
            onClick={onMemoryToggle}
            aria-pressed={memoryOn}
            aria-label={`${memoryLabel}: ${memoryOn ? memoryOnLabel : memoryOffLabel}`}
          >
            {memoryOn ? memoryOnLabel : memoryOffLabel}
          </Button>
        </div>
      </div>

      {/* Scrollable onboarding area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2">
        {allChecked ? (
          <Accordion
            type="single"
            collapsible
            value={accordionOpen ?? ''}
            onValueChange={(v) => setAccordionOpen(v || undefined)}
          >
            <AccordionItem
              value="onboarding"
              className="overflow-hidden rounded-xl border-none data-[state=open]:bg-ds-bg-neutral-default-default"
            >
              <AccordionTrigger className="rounded-xl px-4 py-2.5 text-body-sm font-medium hover:bg-ds-bg-neutral-default-default hover:no-underline data-[state=open]:rounded-b-none [&>svg]:text-ds-icon-neutral-muted-default">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-ds-text-neutral-default-default">
                    {gettingStartedLabel}
                  </span>
                  <span className="shrink-0 text-body-xs text-ds-text-neutral-muted-default">
                    {checkedSteps.size}/{onboardingSteps.length}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-2">
                <div className="flex flex-col gap-2 pb-2">
                  {onboardingSteps.map((step) => (
                    <StepCard
                      key={step.id}
                      id={step.id}
                      title={step.title}
                      subtitle={step.subtitle}
                      checked={true}
                      onClick={() => {}}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : (
          <div className="flex flex-col gap-2">
            {onboardingSteps.map((step) => (
              <StepCard
                key={step.id}
                id={step.id}
                title={step.title}
                subtitle={step.subtitle}
                checked={checkedSteps.has(step.id)}
                onClick={() => handleCheckStep(step.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
