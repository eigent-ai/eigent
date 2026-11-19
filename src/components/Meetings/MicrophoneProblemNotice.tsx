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
import { useHost } from '@/host';
import type { MicrophoneHost } from '@/lib/meetings/microphone';
import type { RecordingProblem } from '@/store/meetingRecordingStore';
import { MicOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const MESSAGE_KEYS: Record<RecordingProblem, string> = {
  denied: 'meetings.problem-denied',
  'no-device': 'meetings.problem-no-device',
  busy: 'meetings.problem-busy',
  unsupported: 'meetings.problem-unsupported',
  unknown: 'meetings.problem-unknown',
  'device-lost': 'meetings.problem-device-lost',
  'start-failed': 'meetings.problem-start-failed',
  'save-failed': 'meetings.problem-save-failed',
};

/**
 * Explains why recording did not start or stopped. A denied permission gets
 * a way to the system's privacy settings where the OS has one.
 */
export default function MicrophoneProblemNotice({
  problem,
  onDismiss,
}: {
  problem: RecordingProblem;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const microphoneHost = host?.electronAPI as MicrophoneHost | null;
  const canOpenSettings =
    problem === 'denied' && Boolean(microphoneHost?.openMicrophoneSettings);

  return (
    <div
      role="alert"
      data-meeting-problem={problem}
      className="flex items-start gap-ds-8 rounded-ds-field border-x border-y border-ds-hairline-default-default bg-ds-neutral-subtle-default p-ds-12"
    >
      <DsIcon
        icon={MicOff}
        className="mt-ds-2 shrink-0 text-ds-icon-error-default-default"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-ds-8">
        <DsText as="p" role="base" className="text-ds-ink-default-default">
          {t(MESSAGE_KEYS[problem])}
        </DsText>
        {canOpenSettings ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void microphoneHost?.openMicrophoneSettings?.()}
            >
              {t('meetings.open-system-settings')}
            </Button>
          </div>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        buttonContent="icon-only"
        aria-label={t('meetings.dismiss')}
        onClick={onDismiss}
      >
        <DsIcon icon={X} recipe="main-compact" aria-hidden />
      </Button>
    </div>
  );
}
