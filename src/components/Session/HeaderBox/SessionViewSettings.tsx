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
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { StepSlider } from '@/components/ui/step-slider';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  narrativeInformationDensities,
  type NarrativeInformationDensity,
} from '@/types/chatTimeline';
import { CodeXml, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SessionViewSettingsProps {
  devMode: boolean;
  density: NarrativeInformationDensity;
  onDevModeChange: (enabled: boolean) => void;
  onDensityChange: (density: NarrativeInformationDensity) => void;
}

export function SessionViewSettings({
  devMode,
  density,
  onDevModeChange,
  onDensityChange,
}: SessionViewSettingsProps) {
  const { t } = useTranslation();
  const densityLabel = (level: NarrativeInformationDensity) =>
    t(`chat.timeline-density-${level}`);
  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-ds-control-gap text-ds-text-base font-normal text-ds-ink-default-default">
        <DsIcon icon={Rows3} recipe="main" />
        {t('chat.timeline-information-density')}
      </DropdownMenuLabel>
      <div className="px-ds-8 pb-ds-8">
        <DropdownMenuItem
          asChild
          role="slider"
          disabled={devMode}
          onSelect={(event) => event.preventDefault()}
        >
          <StepSlider
            min={0}
            max={2}
            value={narrativeInformationDensities.indexOf(density)}
            disabled={devMode}
            aria-label={t('chat.timeline-information-density')}
            aria-valuetext={densityLabel(density)}
            onValueChange={(index) => {
              const nextDensity = narrativeInformationDensities[index];
              if (!devMode && nextDensity) onDensityChange(nextDensity);
            }}
          />
        </DropdownMenuItem>
        <div
          aria-hidden
          className={cn(
            'grid grid-cols-3 gap-ds-4 text-ds-text-meta',
            devMode ? 'text-ds-ink-muted-disabled' : 'text-ds-ink-muted-default'
          )}
        >
          {narrativeInformationDensities.map((level, index) => (
            <span
              key={level}
              className={cn(
                index === 1 && 'text-center',
                index === 2 && 'text-end',
                !devMode &&
                  level === density &&
                  'font-medium text-ds-ink-default-default'
              )}
            >
              {densityLabel(level)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex min-h-ds-control-lg items-center justify-between gap-ds-control-gap px-ds-8 py-ds-4">
        <span className="flex items-center gap-ds-control-gap text-ds-text-base text-ds-ink-default-default">
          <DsIcon icon={CodeXml} recipe="main" />
          {t('chat.timeline-dev-mode')}
        </span>
        <DropdownMenuItem
          asChild
          unstyled
          role="switch"
          onSelect={(event) => event.preventDefault()}
        >
          <Switch
            size="default"
            variant="solid"
            aria-label={t('chat.timeline-dev-mode')}
            checked={devMode}
            onCheckedChange={onDevModeChange}
          />
        </DropdownMenuItem>
      </div>
    </>
  );
}
