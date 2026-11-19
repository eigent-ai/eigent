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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import { Label } from '@/components/ui/label';
import { useHost } from '@/host';
import { defaultMeetingTitle } from '@/lib/meetings/meetingGroups';
import type { MicrophoneHost } from '@/lib/meetings/microphone';
import { useMeetingPreferencesStore } from '@/store/meetingPreferencesStore';
import { useMeetingRecordingStore } from '@/store/meetingRecordingStore';
import { useCallback, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Start a recording. Before the first one, show the consent reminder (plan
 * §4.2). Recording never starts without the person pressing a button.
 */
export function useStartMeetingRecording(): {
  requestStart: () => void;
  dialog: ReactNode;
} {
  const { t, i18n } = useTranslation();
  const host = useHost();
  const { openMeetings } = useHomeNavigation();
  const start = useMeetingRecordingStore((state) => state.start);
  const dismissed = useMeetingPreferencesStore(
    (state) => state.consentReminderDismissed
  );
  const setDismissed = useMeetingPreferencesStore(
    (state) => state.setConsentReminderDismissed
  );
  const [open, setOpen] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const checkboxId = useId();

  const begin = useCallback(async () => {
    const meetingId = await start({
      title: defaultMeetingTitle(new Date(), i18n.language),
      host: host?.electronAPI as MicrophoneHost | null,
    });
    if (meetingId) openMeetings(meetingId);
  }, [host, i18n.language, openMeetings, start]);

  const requestStart = useCallback(() => {
    if (dismissed) {
      void begin();
      return;
    }
    setDontShowAgain(false);
    setOpen(true);
  }, [begin, dismissed]);

  const confirm = () => {
    if (dontShowAgain) setDismissed(true);
    setOpen(false);
    void begin();
  };

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="sm" overlayVariant="dimmed">
        <DialogHeader title={t('meetings.consent-title')} />
        <DialogContentSection>
          <div className="flex flex-col gap-ds-12">
            <DsText as="p" role="base">
              {t('meetings.consent-message')}
            </DsText>
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('meetings.consent-local')}
            </DsText>
            <div className="flex items-center gap-ds-8">
              <Checkbox
                id={checkboxId}
                checked={dontShowAgain}
                onCheckedChange={(value) => setDontShowAgain(value === true)}
              />
              <Label htmlFor={checkboxId}>
                {t('meetings.dont-show-again')}
              </Label>
            </div>
          </div>
        </DialogContentSection>
        <DialogFooter
          showConfirmButton
          showCancelButton
          confirmButtonText={t('meetings.start-recording')}
          cancelButtonText={t('meetings.cancel')}
          onConfirm={confirm}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );

  return { requestStart, dialog };
}
