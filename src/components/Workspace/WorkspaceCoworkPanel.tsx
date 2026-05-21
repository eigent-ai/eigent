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
import { Check, PenLine } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const ONBOARDING_KEY = 'eigent-workspace-onboarding-checked';

const ONBOARDING_STEP_IDS = [1, 2, 3, 4] as const;

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
        'group rounded-xl p-2 gap-2 bg-ds-bg-neutral-subtle-default flex w-full items-start text-left transition-colors',
        checked
          ? 'cursor-default'
          : 'hover:bg-ds-bg-neutral-strong-default cursor-pointer'
      )}
      onClick={checked ? undefined : onClick}
      aria-pressed={checked}
    >
      {/* Circle */}
      <div
        className={cn(
          'mt-0.5 h-4 w-4 flex shrink-0 items-center justify-center rounded-full',
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
          <span className="font-bold text-ds-text-neutral-muted-default text-[8px] leading-none">
            {id}
          </span>
        )}
      </div>

      {/* Text */}
      <div className="min-w-0 flex flex-1 flex-col">
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
  onEditInstructions: () => void;
  onWorkforceSetting: () => void;
}

export function WorkspaceCoworkPanel({
  memoryOn,
  onMemoryToggle,
  onEditInstructions,
  onWorkforceSetting,
}: WorkspaceCoworkPanelProps) {
  const { t } = useTranslation();
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
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const instructionsTitle = t('layout.instructions');
  const instructionsHint = t('layout.instructions-rules-tone');
  const memoryLabel = t('layout.memory');
  const memoryOnLabel = t('layout.memory-on');
  const memoryOffLabel = t('layout.memory-off');
  const workforceSettingLabel = t('layout.workforce-setting');
  const selectLabel = t('layout.select');
  const editInstructionsLabel = t('layout.edit-instructions');
  const gettingStartedLabel = t('layout.getting-started');

  return (
    <div className="pr-1 py-1 flex h-full flex-col overflow-hidden">
      {/* Settings area */}
      <div className="px-2 py-1 gap-0.5 rounded-2xl bg-ds-bg-neutral-default-default flex shrink-0 flex-col">
        {/* Panel title */}
        <div className="px-2 py-1.5 shrink-0">
          <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
            {instructionsTitle}
          </span>
        </div>
        <div className="min-w-0 gap-2 rounded-lg px-2 py-1.5 hover:bg-ds-bg-neutral-strong-default flex items-center justify-between">
          <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default flex-1">
            {instructionsHint}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            buttonContent="icon-only"
            className="no-drag shrink-0"
            aria-label={editInstructionsLabel}
            onClick={onEditInstructions}
          >
            <PenLine className="h-4 w-4 shrink-0" aria-hidden />
          </Button>
        </div>
        <div className="min-w-0 gap-2 rounded-lg px-2 py-1.5 hover:bg-ds-bg-neutral-strong-default flex items-center justify-between">
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
        <div className="min-w-0 gap-2 rounded-lg px-2 py-1.5 hover:bg-ds-bg-neutral-strong-default flex items-center justify-between">
          <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default">
            {workforceSettingLabel}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            className="no-drag shrink-0"
            onClick={onWorkforceSetting}
            aria-label={`${workforceSettingLabel}: ${selectLabel}`}
          >
            {selectLabel}
          </Button>
        </div>
      </div>

      {/* Scrollable onboarding area */}
      <div className="min-h-0 py-2 flex flex-1 flex-col overflow-y-auto">
        {allChecked ? (
          <Accordion
            type="single"
            collapsible
            value={accordionOpen ?? ''}
            onValueChange={(v) => setAccordionOpen(v || undefined)}
          >
            <AccordionItem
              value="onboarding"
              className="rounded-xl data-[state=open]:bg-ds-bg-neutral-default-default overflow-hidden border-none"
            >
              <AccordionTrigger className="px-4 py-2.5 text-body-sm font-medium hover:bg-ds-bg-neutral-default-default rounded-xl [&>svg]:text-ds-icon-neutral-muted-default hover:no-underline data-[state=open]:rounded-b-none">
                <div className="gap-2 min-w-0 flex items-center">
                  <span className="text-ds-text-neutral-default-default font-semibold truncate">
                    {gettingStartedLabel}
                  </span>
                  <span className="text-body-xs text-ds-text-neutral-muted-default shrink-0">
                    {checkedSteps.size}/{onboardingSteps.length}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-2">
                <div className="gap-2 pb-2 flex flex-col">
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
          <div className="gap-2 flex flex-col">
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
