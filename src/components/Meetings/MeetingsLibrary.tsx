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

import SearchInput from '@/components/Dashboard/SearchInput';
import { useHomeNavigation } from '@/components/Home/hooks/useHomeNavigation';
import CollectionToolbar, {
  COLLECTION_TOOLBAR_SEARCH_CLASS,
} from '@/components/Layout/CollectionToolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Tag } from '@/components/ui/tag';
import {
  formatMeetingDuration,
  groupMeetingsByDay,
  type MeetingGroup,
} from '@/lib/meetings/meetingGroups';
import { cn } from '@/lib/utils';
import {
  importMeetingRecording,
  listMeetings,
  updateMeeting,
  type Meeting,
} from '@/service/meetingsApi';
import {
  isRecordingActive,
  useMeetingRecordingStore,
} from '@/store/meetingRecordingStore';
import { useSpaceStore } from '@/store/spaceStore';
import { Mic, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import MeetingStatusBadge from './MeetingStatusBadge';
import MicrophoneProblemNotice from './MicrophoneProblemNotice';
import { useStartMeetingRecording } from './useStartMeetingRecording';

const IMPORT_ACCEPT = '.m4a,.mp3,.mp4,.wav,.ogg,.webm,audio/*';

function groupLabel(
  group: MeetingGroup,
  t: (key: string) => string,
  locale: string
): string {
  switch (group.kind) {
    case 'today':
      return t('meetings.group-today');
    case 'yesterday':
      return t('meetings.group-yesterday');
    case 'this-week':
      return t('meetings.group-this-week');
    default:
      return new Intl.DateTimeFormat(locale, {
        month: 'long',
        year: 'numeric',
      }).format(group.sample);
  }
}

/** Meetings: every recording on this computer, grouped by day (plan §4.4). */
export default function MeetingsLibrary() {
  const { t, i18n } = useTranslation();
  const { openMeetings } = useHomeNavigation();
  const spaces = useSpaceStore((state) => state.spaces);
  const phase = useMeetingRecordingStore((state) => state.phase);
  const activeMeetingId = useMeetingRecordingStore((state) => state.meetingId);
  const problem = useMeetingRecordingStore((state) => state.problem);
  const clearProblem = useMeetingRecordingStore((state) => state.clearProblem);
  const { requestStart, dialog } = useStartMeetingRecording();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const recording = isRecordingActive(phase);

  const load = useCallback(async (search: string) => {
    try {
      const items = await listMeetings(search);
      setMeetings(items);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(query), 200);
    return () => window.clearTimeout(timer);
  }, [load, query, phase]);

  // A meeting still marked as recording that this window is not recording
  // lost its recorder (a reload or crash). Show it as interrupted.
  useEffect(() => {
    const orphaned = meetings.filter(
      (meeting) =>
        meeting.status === 'recording' && meeting.id !== activeMeetingId
    );
    if (orphaned.length === 0) return;
    void Promise.all(
      orphaned.map((meeting) =>
        updateMeeting(meeting.id, { status: 'interrupted' }).catch(
          () => undefined
        )
      )
    ).then(() => load(query));
  }, [activeMeetingId, load, meetings, query]);

  const groups = useMemo(
    () => groupMeetingsByDay(meetings, new Date()),
    [meetings]
  );

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const meeting = await importMeetingRecording(file);
      openMeetings(meeting.id);
    } catch {
      toast.error(t('meetings.import-failed'));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const timeFormat = new Intl.DateTimeFormat(i18n.language, {
    timeStyle: 'short',
  });

  return (
    <div
      className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
      data-meetings-library
    >
      {dialog}
      <CollectionToolbar
        persistentHeader
        aria-label={t('meetings.toolbar-label')}
        headingLevel={1}
        width="wide"
        title={t('meetings.title')}
        count={
          <Badge variant="secondary" size="xs">
            {meetings.length}
          </Badge>
        }
      >
        <div className={COLLECTION_TOOLBAR_SEARCH_CLASS}>
          <SearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('meetings.search')}
          />
        </div>
        <input
          ref={fileInput}
          type="file"
          accept={IMPORT_ACCEPT}
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(event) => void handleImport(event.target.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={importing}
          onClick={() => fileInput.current?.click()}
        >
          <DsIcon icon={Upload} aria-hidden />
          {t('meetings.import-recording')}
        </Button>
        {recording && activeMeetingId ? (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => openMeetings(activeMeetingId)}
          >
            {t('meetings.open-recording')}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={phase === 'starting'}
            onClick={requestStart}
          >
            <DsIcon icon={Mic} aria-hidden />
            {t('meetings.new-meeting')}
          </Button>
        )}
      </CollectionToolbar>

      <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-ds-24 px-ds-32 py-ds-24">
          {problem ? (
            <MicrophoneProblemNotice
              problem={problem}
              onDismiss={clearProblem}
            />
          ) : null}

          {loadFailed ? (
            <DsText as="p" role="base" className="text-ds-ink-muted-default">
              {t('meetings.load-failed')}
            </DsText>
          ) : null}

          {!loading && !loadFailed && meetings.length === 0 ? (
            <div className="flex flex-col items-center gap-ds-12 py-ds-48 text-center">
              <DsIcon
                icon={Mic}
                recipe="illustration"
                illustrationSize={40}
                className="text-ds-ink-muted-default"
                aria-hidden
              />
              <DsText as="h2" role="title" weight="semibold">
                {query ? t('meetings.no-results') : t('meetings.empty-title')}
              </DsText>
              {query ? null : (
                <DsText
                  as="p"
                  role="base"
                  className="text-ds-ink-muted-default"
                >
                  {t('meetings.empty-description')}
                </DsText>
              )}
            </div>
          ) : null}

          {groups.map((group) => (
            <section
              key={group.key}
              aria-label={groupLabel(group, t, i18n.language)}
              className="flex flex-col gap-ds-4"
            >
              <DsText
                as="h2"
                role="meta"
                weight="semibold"
                className="px-ds-8 text-ds-ink-muted-default"
              >
                {groupLabel(group, t, i18n.language)}
              </DsText>
              <ul className="flex flex-col">
                {group.meetings.map((meeting) => (
                  <li key={meeting.id}>
                    <button
                      type="button"
                      data-meeting-row={meeting.id}
                      onClick={() => openMeetings(meeting.id)}
                      className={cn(
                        'flex min-h-ds-control-lg w-full min-w-0 items-center gap-ds-12 rounded-ds-menu-row px-ds-8 py-ds-6 text-left hover:bg-ds-neutral-subtle-hover',
                        DS_FOCUS_RING
                      )}
                    >
                      <DsText
                        as="span"
                        role="base"
                        weight="semibold"
                        className="min-w-0 flex-1 truncate"
                        title={meeting.title}
                      >
                        {meeting.title}
                      </DsText>
                      <span className="flex shrink-0 items-center gap-ds-6">
                        <MeetingStatusBadge status={meeting.status} />
                        {meeting.spaces.map((link) => (
                          <Tag
                            key={link.space_id}
                            variant="secondary"
                            tone="neutral"
                            size="xs"
                          >
                            {spaces[link.space_id]?.name ?? link.space_id}
                          </Tag>
                        ))}
                        <DsText
                          as="span"
                          role="meta"
                          className="text-ds-ink-muted-default tabular-nums"
                        >
                          {timeFormat.format(
                            new Date(meeting.started_at * 1000)
                          )}
                          {' · '}
                          {formatMeetingDuration(meeting.duration_ms)}
                        </DsText>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
