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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StepSlider } from '@/components/ui/step-slider';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  REPLAY_SPEEDS,
  type ReplaySpeed,
  type ReplayState,
} from '@/lib/sessionReplay/replayController';
import type {
  ReplayMarker,
  ReplayMarkerKind,
} from '@/lib/sessionReplay/replayMarkers';
import { cn } from '@/lib/utils';
import { LogOut, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MARKER_FILL: Record<ReplayMarkerKind, string> = {
  approval: 'bg-ds-bg-warning-strong-default',
  question: 'bg-ds-bg-information-strong-default',
  error: 'bg-ds-bg-error-strong-default',
  final: 'bg-ds-bg-success-strong-default',
};

const MARKER_LABEL_KEY: Record<ReplayMarkerKind, string> = {
  approval: 'chat.session-replay.marker-approval',
  question: 'chat.session-replay.marker-question',
  error: 'chat.session-replay.marker-error',
  final: 'chat.session-replay.marker-final',
};

function speedLabel(speed: ReplaySpeed, t: (key: string) => string): string {
  return speed === 'instant'
    ? t('chat.session-replay.speed-instant')
    : `${speed}×`;
}

export function ReplayToolbar({
  state,
  markers,
  disabled,
  onToggle,
  onStepBack,
  onStepForward,
  onSeek,
  onSpeedChange,
  onExit,
}: {
  state: ReplayState;
  markers: readonly ReplayMarker[];
  disabled?: boolean;
  onToggle: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onSeek: (position: number) => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const playLabel = state.playing
    ? t('chat.session-replay.pause')
    : t('chat.session-replay.play');

  return (
    <div
      className="flex shrink-0 flex-col gap-ds-6 border-x-0 border-t border-b-0 border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default px-ds-page-gutter py-ds-8"
      role="toolbar"
      aria-label={t('chat.session-replay.controls-label')}
    >
      <StepSlider
        min={0}
        max={Math.max(state.total, 1)}
        value={state.position}
        disabled={disabled}
        onValueChange={onSeek}
        aria-label={t('chat.session-replay.scrubber-label')}
        aria-valuetext={t('chat.session-replay.position', {
          position: state.position,
          total: state.total,
        })}
      />
      {state.total > 0 && markers.length > 0 ? (
        <ol
          className="relative h-ds-24"
          aria-label={t('chat.session-replay.markers-label')}
        >
          {markers.map((marker) => (
            <li
              key={marker.eventId}
              className="absolute top-0 -translate-x-1/2"
              // Runtime position along the scrubber track.
              style={{ left: `${(marker.position / state.total) * 100}%` }}
            >
              <TooltipSimple content={t(MARKER_LABEL_KEY[marker.kind])}>
                <button
                  type="button"
                  className="flex size-ds-24 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none"
                  aria-label={t(MARKER_LABEL_KEY[marker.kind])}
                  onClick={() => onSeek(marker.position)}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-ds-8 rounded-full',
                      MARKER_FILL[marker.kind]
                    )}
                  />
                </button>
              </TooltipSimple>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="flex min-w-0 items-center gap-ds-control-gap">
        <Button variant="secondary" size="sm" onClick={onExit}>
          <DsIcon icon={LogOut} recipe="main" />
          {t('chat.session-replay.exit')}
        </Button>
        <div className="flex flex-1 items-center justify-center gap-ds-4">
          <Button
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('chat.session-replay.previous-step')}
            disabled={disabled || state.position === 0}
            onClick={onStepBack}
          >
            <DsIcon icon={SkipBack} recipe="main" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            buttonContent="icon-only"
            aria-label={playLabel}
            aria-pressed={state.playing}
            disabled={disabled}
            onClick={onToggle}
          >
            <DsIcon icon={state.playing ? Pause : Play} recipe="main" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('chat.session-replay.next-step')}
            disabled={disabled || state.position >= state.total}
            onClick={onStepForward}
          >
            <DsIcon icon={SkipForward} recipe="main" />
          </Button>
        </div>
        <DsText
          as="span"
          role="meta"
          className="text-ds-ink-muted-default tabular-nums"
          aria-live="off"
        >
          {t('chat.session-replay.position', {
            position: state.position,
            total: state.total,
          })}
        </DsText>
        <Select
          value={String(state.speed)}
          disabled={disabled}
          onValueChange={(value) =>
            onSpeedChange(
              value === 'instant' ? 'instant' : (Number(value) as ReplaySpeed)
            )
          }
        >
          <SelectTrigger
            size="xs"
            aria-label={t('chat.session-replay.speed-label')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPLAY_SPEEDS.map((speed) => (
              <SelectItem key={String(speed)} value={String(speed)}>
                {speedLabel(speed, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
