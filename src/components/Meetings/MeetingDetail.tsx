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
import ContentHeader, {
  CONTENT_HEADER_TITLE_CLASS,
} from '@/components/Layout/ContentHeader';
import AlertDialog from '@/components/ui/alertDialog';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tag } from '@/components/ui/tag';
import { Textarea } from '@/components/ui/textarea';
import { formatMeetingDuration } from '@/lib/meetings/meetingGroups';
import {
  deleteMeeting,
  fetchMeetingRecording,
  getMeeting,
  removeMeetingFromSpace,
  updateMeeting,
  type Meeting,
  type MeetingTypedNote,
} from '@/service/meetingsApi';
import { useMeetingRecordingStore } from '@/store/meetingRecordingStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ArrowLeft, Pause, Play, Square, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import AddMeetingToSpaceDialog, {
  copyMeetingToSpace,
} from './AddMeetingToSpaceDialog';
import { RecordingDot } from './MeetingRecordingIndicator';
import MeetingStatusBadge from './MeetingStatusBadge';
import MicrophoneProblemNotice from './MicrophoneProblemNotice';
import { useRecordingElapsed } from './useRecordingElapsed';

function TypedNotesList({ notes }: { notes: MeetingTypedNote[] }) {
  const { t } = useTranslation();
  if (notes.length === 0) {
    return (
      <DsText as="p" role="base" className="text-ds-ink-muted-default">
        {t('meetings.no-typed-notes')}
      </DsText>
    );
  }
  return (
    <ol className="flex flex-col gap-ds-4" data-meeting-typed-notes>
      {notes.map((note, index) => (
        <li key={`${note.at_ms}-${index}`} className="flex gap-ds-12">
          <DsText
            as="span"
            role="base"
            className="shrink-0 text-ds-ink-muted-default tabular-nums"
          >
            {formatMeetingDuration(note.at_ms)}
          </DsText>
          <DsText as="span" role="base" className="min-w-0 break-words">
            {note.text}
          </DsText>
        </li>
      ))}
    </ol>
  );
}

/** Controls shown on the meeting page while it is being recorded. */
function RecordingPanel() {
  const { t } = useTranslation();
  const phase = useMeetingRecordingStore((state) => state.phase);
  const typedNotes = useMeetingRecordingStore((state) => state.typedNotes);
  const pause = useMeetingRecordingStore((state) => state.pause);
  const resume = useMeetingRecordingStore((state) => state.resume);
  const stop = useMeetingRecordingStore((state) => state.stop);
  const addTypedNote = useMeetingRecordingStore((state) => state.addTypedNote);
  const elapsed = useRecordingElapsed();
  const [draft, setDraft] = useState('');
  const paused = phase === 'paused';
  const saving = phase === 'saving';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    addTypedNote(draft);
    setDraft('');
  };

  return (
    <section
      aria-label={t('meetings.recording-controls')}
      data-meeting-recording-panel={phase}
      className="flex flex-col gap-ds-12 rounded-ds-card border-x border-y border-ds-hairline-default-default p-ds-16"
    >
      <div className="flex flex-wrap items-center gap-ds-8">
        <RecordingDot paused={paused} />
        <DsText as="span" role="base" weight="semibold">
          {paused
            ? t('meetings.indicator-paused')
            : saving
              ? t('meetings.indicator-saving')
              : t('meetings.indicator-recording')}
        </DsText>
        <DsText
          as="span"
          role="base"
          className="text-ds-ink-muted-default tabular-nums"
        >
          {formatMeetingDuration(elapsed)}
        </DsText>
        <div className="ml-auto flex items-center gap-ds-8">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={paused ? resume : pause}
          >
            <DsIcon icon={paused ? Play : Pause} aria-hidden />
            {paused ? t('meetings.resume') : t('meetings.pause')}
          </Button>
          <Button
            type="button"
            variant="primary"
            tone="error"
            size="sm"
            disabled={saving}
            onClick={() => void stop()}
          >
            <DsIcon icon={Square} aria-hidden />
            {t('meetings.stop')}
          </Button>
        </div>
      </div>
      <form onSubmit={submit} className="flex gap-ds-8">
        <Input
          size="sm"
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('meetings.typed-note-placeholder')}
          aria-label={t('meetings.typed-note-label')}
        />
        <Button
          type="submit"
          variant="secondary"
          size="md"
          disabled={saving || !draft.trim()}
        >
          {t('meetings.add-note')}
        </Button>
      </form>
      <TypedNotesList notes={typedNotes} />
    </section>
  );
}

function RecordingPlayer({ meetingId }: { meetingId: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchMeetingRecording(meetingId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meetingId]);

  if (failed) {
    return (
      <DsText as="p" role="base" className="text-ds-ink-muted-default">
        {t('meetings.recording-unavailable')}
      </DsText>
    );
  }
  if (!url) return null;
  return (
    <audio
      controls
      src={url}
      className="w-full"
      aria-label={t('meetings.recording')}
    />
  );
}

export default function MeetingDetail({ meetingId }: { meetingId: string }) {
  const { t, i18n } = useTranslation();
  const { openMeetings } = useHomeNavigation();
  const spaces = useSpaceStore((state) => state.spaces);
  const activeMeetingId = useMeetingRecordingStore((state) => state.meetingId);
  const lastSavedMeetingId = useMeetingRecordingStore(
    (state) => state.lastSavedMeetingId
  );
  const problem = useMeetingRecordingStore((state) => state.problem);
  const clearProblem = useMeetingRecordingStore((state) => state.clearProblem);
  const isBeingRecorded = activeMeetingId === meetingId;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [replaceSpaceId, setReplaceSpaceId] = useState<string | null>(null);

  const apply = useCallback((next: Meeting) => {
    setMeeting(next);
    setTitle(next.title);
    setNote(next.note_markdown);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await getMeeting(meetingId));
    } catch {
      setNotFound(true);
    }
  }, [apply, meetingId]);

  // Reload when this meeting's recording finishes saving.
  useEffect(() => {
    void load();
  }, [load, isBeingRecorded, lastSavedMeetingId]);

  const back = () => openMeetings();

  if (notFound) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-ds-12 p-ds-32 text-center">
        <DsText as="p" role="base" className="text-ds-ink-muted-default">
          {t('meetings.not-found')}
        </DsText>
        <Button type="button" variant="secondary" size="sm" onClick={back}>
          <DsIcon icon={ArrowLeft} aria-hidden />
          {t('meetings.back-to-meetings')}
        </Button>
      </div>
    );
  }
  if (!meeting) return null;

  const saveTitle = async () => {
    const next = title.trim();
    if (!next || next === meeting.title) {
      setTitle(meeting.title);
      return;
    }
    try {
      apply(await updateMeeting(meeting.id, { title: next }));
    } catch {
      toast.error(t('meetings.save-failed'));
    }
  };

  const saveNote = async () => {
    setSavingNote(true);
    try {
      apply(await updateMeeting(meeting.id, { note_markdown: note }));
      toast.success(t('meetings.note-saved'));
    } catch {
      toast.error(t('meetings.save-failed'));
    } finally {
      setSavingNote(false);
    }
  };

  const updateCopy = async (spaceId: string, overwrite = false) => {
    const outcome = await copyMeetingToSpace(meeting.id, spaceId, overwrite);
    if (outcome.kind === 'added') {
      apply(outcome.meeting);
      toast.success(t('meetings.copy-updated'));
    } else if (outcome.kind === 'conflict') {
      setReplaceSpaceId(spaceId);
    } else if (outcome.kind === 'no-folder') {
      toast.error(t('meetings.space-has-no-folder'));
    } else {
      toast.error(t('meetings.add-to-space-failed'));
    }
  };

  const removeLink = async (spaceId: string) => {
    try {
      apply(await removeMeetingFromSpace(meeting.id, spaceId));
      toast.success(t('meetings.removed-from-space'));
    } catch {
      toast.error(t('meetings.save-failed'));
    }
  };

  const confirmDelete = async () => {
    try {
      await deleteMeeting(meeting.id);
      back();
    } catch {
      toast.error(t('meetings.delete-failed'));
    }
  };

  const spaceName = (spaceId: string) => spaces[spaceId]?.name ?? spaceId;
  const noteDirty = note !== meeting.note_markdown;
  const started = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(meeting.started_at * 1000));

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col"
      data-meeting-detail={meeting.id}
    >
      <ContentHeader
        persistent
        className="px-ds-16"
        titleAsChild
        leading={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label={t('meetings.back-to-meetings')}
            onClick={back}
          >
            <DsIcon icon={ArrowLeft} aria-hidden />
          </Button>
        }
        title={
          <h1 className={CONTENT_HEADER_TITLE_CLASS} title={meeting.title}>
            {meeting.title}
          </h1>
        }
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              aria-label={t('meetings.delete')}
              disabled={isBeingRecorded}
              onClick={() => setDeleteOpen(true)}
            >
              <DsIcon icon={Trash2} aria-hidden />
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isBeingRecorded}
              onClick={() => setAddOpen(true)}
            >
              {t('meetings.add-to-space')}
            </Button>
          </>
        }
      />

      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[964px] flex-col gap-ds-16 px-ds-32 py-ds-24">
          <div className="flex flex-wrap items-center gap-ds-8">
            <DsText as="span" role="base" className="text-ds-ink-muted-default">
              {started}
              {' · '}
              {formatMeetingDuration(meeting.duration_ms)}
            </DsText>
            {isBeingRecorded ? null : (
              <MeetingStatusBadge status={meeting.status} />
            )}
          </div>

          {problem && (isBeingRecorded || lastSavedMeetingId === meetingId) ? (
            <MicrophoneProblemNotice
              problem={problem}
              onDismiss={clearProblem}
            />
          ) : null}

          {meeting.status === 'interrupted' ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('meetings.interrupted-explanation')}
            </DsText>
          ) : null}

          <Input
            size="sm"
            title={t('meetings.title-label')}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />

          {isBeingRecorded ? <RecordingPanel /> : null}

          {meeting.spaces.length > 0 ? (
            <section
              aria-label={t('meetings.added-to-spaces')}
              className="flex flex-col gap-ds-8"
            >
              <DsText as="h2" role="meta" weight="semibold">
                {t('meetings.added-to-spaces')}
              </DsText>
              <ul className="flex flex-col gap-ds-6">
                {meeting.spaces.map((link) => (
                  <li
                    key={link.space_id}
                    data-meeting-space-link={link.space_id}
                    className="flex flex-wrap items-center gap-ds-8"
                  >
                    <Tag variant="secondary" tone="neutral" size="sm">
                      {spaceName(link.space_id)}
                    </Tag>
                    <DsText
                      as="span"
                      role="meta"
                      className="min-w-0 truncate text-ds-ink-muted-default"
                      title={link.relative_path}
                    >
                      {link.relative_path}
                    </DsText>
                    {link.changed_since_added ? (
                      <>
                        <DsText as="span" role="meta">
                          {t('meetings.changed-since-added', {
                            space: spaceName(link.space_id),
                          })}
                        </DsText>
                        <Button
                          type="button"
                          variant="secondary"
                          size="xs"
                          onClick={() => void updateCopy(link.space_id)}
                        >
                          {t('meetings.update-copy')}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      buttonContent="icon-only"
                      aria-label={t('meetings.remove-from-space', {
                        space: spaceName(link.space_id),
                      })}
                      title={t('meetings.remove-from-space-hint')}
                      onClick={() => void removeLink(link.space_id)}
                    >
                      <DsIcon icon={X} recipe="main-compact" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Tabs defaultValue="note" className="flex flex-col gap-ds-12">
            <TabsList>
              <TabsTrigger value="note">{t('meetings.tab-note')}</TabsTrigger>
              <TabsTrigger value="typed">
                {t('meetings.tab-your-notes')}
              </TabsTrigger>
              {meeting.recording_kept ? (
                <TabsTrigger value="recording">
                  {t('meetings.tab-recording')}
                </TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent value="note" className="flex flex-col gap-ds-8">
              <DsText as="p" role="meta" className="text-ds-ink-muted-default">
                {t('meetings.note-help')}
              </DsText>
              <Textarea
                variant="outlined"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                aria-label={t('meetings.tab-note')}
                rows={16}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!noteDirty || savingNote}
                  onClick={() => void saveNote()}
                >
                  {t('meetings.save-note')}
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="typed">
              <TypedNotesList notes={meeting.typed_notes} />
            </TabsContent>
            {meeting.recording_kept ? (
              <TabsContent value="recording">
                <RecordingPlayer meetingId={meeting.id} />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>
      </div>

      <AddMeetingToSpaceDialog
        meeting={meeting}
        open={addOpen}
        onOpenChange={setAddOpen}
        onUpdated={apply}
      />
      <AlertDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void confirmDelete()}
        title={t('meetings.delete-title')}
        message={
          meeting.spaces.length > 0
            ? t('meetings.delete-message-with-copies')
            : t('meetings.delete-message')
        }
        confirmText={t('meetings.delete')}
        cancelText={t('meetings.cancel')}
        confirmTone="error"
      />
      <AlertDialog
        isOpen={replaceSpaceId !== null}
        onClose={() => setReplaceSpaceId(null)}
        onConfirm={() => {
          const spaceId = replaceSpaceId;
          setReplaceSpaceId(null);
          if (spaceId) void updateCopy(spaceId, true);
        }}
        title={t('meetings.replace-copy-title')}
        message={t('meetings.replace-copy-message', {
          space: replaceSpaceId ? spaceName(replaceSpaceId) : '',
        })}
        confirmText={t('meetings.replace')}
        cancelText={t('meetings.cancel')}
      />
    </div>
  );
}
