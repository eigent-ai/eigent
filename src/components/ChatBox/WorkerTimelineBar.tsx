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
import type { SessionWorker } from '@/lib/projector/chat/workerView';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Title row of a worker timeline: who it is and the way back. */
export function WorkerTimelineHeader({
  worker,
  workerKey,
  onBack,
}: {
  worker: SessionWorker | undefined;
  workerKey: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      data-worker-timeline-header
      className="mx-auto flex w-full max-w-[736px] items-center gap-ds-8 px-ds-panel-inset pt-ds-12 pb-ds-8"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        buttonContent="icon-only"
        buttonRadius="full"
        aria-label={t('chat.worker-timeline-back', {
          defaultValue: 'Back to session',
        })}
        onClick={onBack}
      >
        <DsIcon icon={ArrowLeft} aria-hidden />
      </Button>
      <div className="flex min-w-0 flex-col">
        <DsText
          as="h2"
          role="body-large"
          weight="semibold"
          className="truncate text-ds-ink-default-default"
          title={worker?.name ?? workerKey}
        >
          {worker?.name ?? workerKey}
        </DsText>
        <DsText
          as="p"
          role="meta"
          className="truncate text-ds-ink-muted-default"
        >
          {worker?.currentTask ||
            t('chat.worker-timeline-subtitle', {
              defaultValue: 'Worker in this session',
            })}
        </DsText>
      </div>
    </div>
  );
}

/** Takes the composer's place: replies go to the Session, not one worker. */
export function WorkerTimelineReplyNotice({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      data-worker-timeline-reply-notice
      className="flex items-center justify-between gap-ds-8 px-ds-panel-inset py-ds-8"
    >
      <DsText as="p" role="base" className="text-ds-ink-muted-default">
        {t('chat.worker-timeline-reply-hint', {
          defaultValue: 'To reply, go back to the session.',
        })}
      </DsText>
      <Button type="button" variant="secondary" size="sm" onClick={onBack}>
        {t('chat.worker-timeline-back', { defaultValue: 'Back to session' })}
      </Button>
    </div>
  );
}
