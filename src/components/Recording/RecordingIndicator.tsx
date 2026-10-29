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
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  useRecording,
  useRecordingMonitor,
  useStopRecording,
} from '@/hooks/useRecording';
import { CircleStop } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function recordingElapsed(start: number | null, now: number): string {
  const seconds =
    start === null ? 0 : Math.max(0, Math.floor(now / 1000 - start));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function RecordingIndicator() {
  useRecordingMonitor();
  const { active, connected } = useRecording();
  const stop = useStopRecording();
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const [stopping, setStopping] = useState(false);
  const activeId = active?.id;
  useEffect(() => {
    if (!activeId) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeId]);
  if (!active) return null;
  const state = active.state;
  const canStop = state === 'starting' || state === 'recording';
  return (
    <div
      className="no-drag flex shrink-0 items-center gap-ds-control-gap"
      aria-label={t('layout.recording-label')}
    >
      <DsText
        as="span"
        role="meta"
        className="text-ds-ink-default-default"
        aria-live="polite"
      >
        {t(`layout.recording-state-${state}`)}
        {!connected ? ` · ${t('layout.recording-reconnecting')}` : ''}
      </DsText>
      {state === 'recording' ? (
        <DsText
          as="span"
          role="meta"
          className="text-ds-ink-muted-default tabular-nums"
        >
          {recordingElapsed(active.started_at, now)}
        </DsText>
      ) : null}
      {canStop ? (
        <TooltipSimple
          content={t('layout.recording-stop')}
          side="bottom"
          variant="instant"
        >
          <Button
            variant="secondary"
            buttonContent="icon-only"
            size="sm"
            disabled={stopping}
            onClick={() => {
              setStopping(true);
              void stop(active.id)
                .catch(() => toast.error(t('layout.recording-stop-failed')))
                .finally(() => setStopping(false));
            }}
            aria-label={t('layout.recording-stop')}
          >
            <DsIcon icon={CircleStop} />
          </Button>
        </TooltipSimple>
      ) : null}
    </div>
  );
}
