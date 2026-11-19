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

import { useHomeNavigation } from '@/components/Home/hooks/useHomeNavigation';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { formatMeetingDuration } from '@/lib/meetings/meetingGroups';
import {
  isRecordingActive,
  useMeetingRecordingStore,
} from '@/store/meetingRecordingStore';
import { useTranslation } from 'react-i18next';
import { useRecordingElapsed } from './useRecordingElapsed';

/** Red dot that marks a live recording. Paused shows it hollow. */
export function RecordingDot({ paused = false }: { paused?: boolean }) {
  return (
    <span
      aria-hidden
      data-recording-dot={paused ? 'paused' : 'live'}
      className={
        paused
          ? 'size-2 shrink-0 rounded-full border-x border-y border-ds-text-error-default-default'
          : 'size-2 shrink-0 animate-pulse rounded-full bg-ds-bg-error-strong-default motion-reduce:animate-none'
      }
    />
  );
}

/**
 * Always on screen while a meeting is recorded, on every page of the app
 * (plan §6). It names the state in words, so it does not rely on color.
 */
export default function MeetingRecordingIndicator() {
  const { t } = useTranslation();
  const phase = useMeetingRecordingStore((state) => state.phase);
  const meetingId = useMeetingRecordingStore((state) => state.meetingId);
  const stop = useMeetingRecordingStore((state) => state.stop);
  const elapsed = useRecordingElapsed();
  const { openMeetings } = useHomeNavigation();

  if (!isRecordingActive(phase) || !meetingId) return null;

  const label =
    phase === 'paused'
      ? t('meetings.indicator-paused')
      : phase === 'saving'
        ? t('meetings.indicator-saving')
        : t('meetings.indicator-recording');

  return (
    <div
      role="status"
      aria-live="polite"
      data-meeting-recording-indicator={phase}
      className="pointer-events-auto absolute right-ds-16 bottom-ds-16 z-50 flex items-center gap-ds-8 rounded-full border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default py-ds-4 pr-ds-4 pl-ds-12 shadow-ds-elevation-floating"
    >
      <RecordingDot paused={phase === 'paused'} />
      <DsText as="span" role="base" weight="semibold">
        {label}
      </DsText>
      <DsText
        as="span"
        role="base"
        className="text-ds-ink-muted-default tabular-nums"
      >
        {formatMeetingDuration(elapsed)}
      </DsText>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => openMeetings(meetingId)}
      >
        {t('meetings.open-meeting')}
      </Button>
      <Button
        type="button"
        variant="secondary"
        tone="error"
        size="xs"
        disabled={phase === 'saving'}
        onClick={() => void stop()}
      >
        {t('meetings.stop')}
      </Button>
    </div>
  );
}
