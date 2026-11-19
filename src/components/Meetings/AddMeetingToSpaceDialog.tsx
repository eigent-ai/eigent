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

import AlertDialog from '@/components/ui/alertDialog';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  addMeetingToSpace,
  meetingErrorCode,
  type Meeting,
} from '@/service/meetingsApi';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

export type AddToSpaceOutcome =
  | { kind: 'added'; meeting: Meeting }
  | { kind: 'conflict' }
  | { kind: 'no-folder' }
  | { kind: 'failed' };

/** Copy the note into a Space; a changed Space file is never replaced silently. */
export async function copyMeetingToSpace(
  meetingId: string,
  spaceId: string,
  overwrite = false
): Promise<AddToSpaceOutcome> {
  const { email, user_id } = useAuthStore.getState();
  try {
    const meeting = await addMeetingToSpace(
      meetingId,
      spaceId,
      { email: email ?? '', userId: user_id },
      overwrite
    );
    return { kind: 'added', meeting };
  } catch (error) {
    const code = meetingErrorCode(error);
    if (code === 'meeting_copy_conflict') return { kind: 'conflict' };
    if (
      code === 'workspace_binding_not_found' ||
      code === 'workspace_binding_unavailable'
    ) {
      return { kind: 'no-folder' };
    }
    return { kind: 'failed' };
  }
}

/** Space picker for Add to Space and Update copy (plan §4.5). */
export function useSpaceChoices() {
  const spaces = useSpaceStore((state) => state.spaces);
  return useMemo(
    () =>
      Object.values(spaces)
        .filter((space) => space.status === 'active')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [spaces]
  );
}

export default function AddMeetingToSpaceDialog({
  meeting,
  open,
  onOpenChange,
  onUpdated,
}: {
  meeting: Meeting;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (meeting: Meeting) => void;
}) {
  const { t } = useTranslation();
  const choices = useSpaceChoices();
  const [spaceId, setSpaceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const spaceName =
    choices.find((space) => space.id === spaceId)?.name ?? spaceId;

  const run = async (overwrite: boolean) => {
    if (!spaceId) return;
    setBusy(true);
    setMessage(null);
    const outcome = await copyMeetingToSpace(meeting.id, spaceId, overwrite);
    setBusy(false);
    if (outcome.kind === 'added') {
      onUpdated(outcome.meeting);
      onOpenChange(false);
    } else if (outcome.kind === 'conflict') {
      setConfirmReplace(true);
    } else if (outcome.kind === 'no-folder') {
      setMessage(t('meetings.space-has-no-folder'));
    } else {
      setMessage(t('meetings.add-to-space-failed'));
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setMessage(null);
          onOpenChange(next);
        }}
      >
        <DialogContent size="sm" overlayVariant="dimmed">
          <DialogHeader
            title={t('meetings.add-to-space')}
            subtitle={t('meetings.add-to-space-description')}
          />
          <DialogContentSection>
            <div className="flex flex-col gap-ds-12">
              <Select value={spaceId} onValueChange={setSpaceId}>
                <SelectTrigger aria-label={t('meetings.choose-space')}>
                  <SelectValue placeholder={t('meetings.choose-space')} />
                </SelectTrigger>
                <SelectContent fitTrigger>
                  {choices.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {choices.length === 0 ? (
                <DsText
                  as="p"
                  role="base"
                  className="text-ds-ink-muted-default"
                >
                  {t('meetings.no-spaces')}
                </DsText>
              ) : null}
              {message ? (
                <DsText
                  as="p"
                  role="base"
                  className="text-ds-text-error-default-default"
                >
                  {message}
                </DsText>
              ) : null}
            </div>
          </DialogContentSection>
          <DialogFooter
            showConfirmButton
            showCancelButton
            confirmButtonText={t('meetings.add')}
            cancelButtonText={t('meetings.cancel')}
            confirmButtonDisabled={!spaceId || busy}
            onConfirm={() => void run(false)}
            onCancel={() => onOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog
        isOpen={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        onConfirm={() => {
          setConfirmReplace(false);
          void run(true);
        }}
        title={t('meetings.replace-copy-title')}
        message={t('meetings.replace-copy-message', { space: spaceName })}
        confirmText={t('meetings.replace')}
        cancelText={t('meetings.cancel')}
      />
    </>
  );
}
