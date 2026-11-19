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
  fetchDelete,
  fetchGet,
  fetchGetBlob,
  fetchPatch,
  fetchPost,
  fetchPostForm,
} from '@/api/http';

/** Local Meetings API (`backend/app/controller/meeting_controller.py`). */

export type MeetingStatus = 'recording' | 'ready' | 'interrupted' | 'failed';
export type MeetingSource = 'microphone' | 'import';

export interface MeetingTypedNote {
  at_ms: number;
  text: string;
}

export interface MeetingSpaceLink {
  space_id: string;
  relative_path: string;
  written_at: number;
  changed_since_added: boolean;
}

export interface Meeting {
  id: string;
  title: string;
  status: MeetingStatus;
  source: MeetingSource;
  /** Seconds since the epoch, as the backend stores them. */
  started_at: number;
  ended_at: number | null;
  duration_ms: number;
  recording_file: string | null;
  recording_bytes: number;
  recording_kept: boolean;
  note_markdown: string;
  note_edited: boolean;
  typed_notes: MeetingTypedNote[];
  spaces: MeetingSpaceLink[];
}

export interface MeetingUpdate {
  title?: string;
  status?: Exclude<MeetingStatus, 'recording'>;
  duration_ms?: number;
  ended_at?: number;
  typed_notes?: MeetingTypedNote[];
  note_markdown?: string;
}

export interface MeetingSpaceIdentity {
  email: string;
  userId?: string | number | null;
}

const meetingPath = (meetingId: string) =>
  `/meetings/${encodeURIComponent(meetingId)}`;

export const listMeetings = async (query?: string): Promise<Meeting[]> => {
  const response = await fetchGet(
    '/meetings',
    query?.trim() ? { q: query.trim() } : undefined
  );
  return response?.items ?? [];
};

export const getMeeting = (meetingId: string): Promise<Meeting> =>
  fetchGet(meetingPath(meetingId));

export const createMeeting = (title: string): Promise<Meeting> =>
  fetchPost('/meetings', { title, started_at: Date.now() / 1000 });

export const updateMeeting = (
  meetingId: string,
  update: MeetingUpdate
): Promise<Meeting> => fetchPatch(meetingPath(meetingId), update);

export const deleteMeeting = (
  meetingId: string
): Promise<{ deleted: boolean; space_copies_kept: string[] }> =>
  fetchDelete(meetingPath(meetingId));

export const uploadMeetingRecording = (
  meetingId: string,
  recording: Blob,
  fileName: string
): Promise<Meeting> => {
  const form = new FormData();
  form.append('file', recording, fileName);
  return fetchPostForm(`${meetingPath(meetingId)}/recording`, form);
};

export const importMeetingRecording = (file: File): Promise<Meeting> => {
  const form = new FormData();
  form.append('file', file, file.name);
  return fetchPostForm('/meetings/import', form);
};

export const fetchMeetingRecording = (meetingId: string): Promise<Blob> =>
  fetchGetBlob(`${meetingPath(meetingId)}/recording`);

export const addMeetingToSpace = (
  meetingId: string,
  spaceId: string,
  identity: MeetingSpaceIdentity,
  overwrite = false
): Promise<Meeting> =>
  fetchPost(`${meetingPath(meetingId)}/spaces/${encodeURIComponent(spaceId)}`, {
    email: identity.email,
    ...(identity.userId === undefined || identity.userId === null
      ? {}
      : { user_id: identity.userId }),
    overwrite,
  });

export const removeMeetingFromSpace = (
  meetingId: string,
  spaceId: string
): Promise<Meeting> =>
  fetchDelete(
    `${meetingPath(meetingId)}/spaces/${encodeURIComponent(spaceId)}`
  );

/** The backend's `detail.code`, when a request failed with one. */
export function meetingErrorCode(error: unknown): string | null {
  const detail = (error as { response?: { data?: { detail?: unknown } } })
    ?.response?.data?.detail;
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const code = (detail as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}
