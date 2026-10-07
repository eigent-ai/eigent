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

import { fetchGet, fetchPost } from '@/api/http';
import {
  closeIdleSSEConnectionsForTasks,
  getIdleSSETransportTaskId,
  waitForIdleSSEDisplayTail,
} from '@/store/chatStore';
import type { Project } from '@/store/projectStore';
import i18next from 'i18next';

/** `GET /chat/{project_id}/status` for a Project's compatibility consumer. */
export interface LegacyChatRuntimeStatus {
  has_lock?: boolean;
  status?: string;
  run_id?: string | null;
  consumer_alive?: boolean;
  subscriber_count?: number;
}

/**
 * - `warm`: post to the idle consumer, whose stream this renderer still holds.
 * - `cold`: no consumer remains; start a new Run with its own stream.
 * - `busy`: the consumer is still executing or preparing a Run.
 */
export type FollowUpAdmission = 'warm' | 'cold' | 'busy';

/** The consumer is alive but has not settled into an idle completed Run. */
export const isLegacyRuntimeBusy = (status: LegacyChatRuntimeStatus) =>
  Boolean(
    status.consumer_alive && (status.status !== 'done' || !status.run_id)
  );

/** Stop an idle warm consumer; resolves false if one is still alive. */
export async function retireIdleLegacyRuntime(
  projectId: string,
  runId: string | null | undefined,
  { signal }: { signal?: AbortSignal } = {}
): Promise<boolean> {
  const retired: LegacyChatRuntimeStatus | null = await fetchPost(
    `/chat/${encodeURIComponent(projectId)}/runtime/retire-idle`,
    { run_id: runId },
    undefined,
    { signal }
  );
  return !retired?.consumer_alive;
}

/**
 * Decide how a follow-up enters a Project, shared by every follow-up sender.
 *
 * A warm follow-up runs inside the idle consumer and reaches the UI only
 * through the `/chat` stream that consumer publishes to. A finished Run does
 * not reconnect that stream after sleep or a network change (#1212), while
 * Brain keeps the consumer alive, so `consumer_alive` alone would admit a Run
 * that nobody observes. Post warm only while this renderer holds the idle
 * stream of the consumer's Run and Brain still counts a subscriber. Otherwise
 * retire the idle consumer and close idle streams so the caller can admit the
 * follow-up cold, with its own stream. A busy consumer is left untouched.
 */
export async function prepareFollowUpAdmission(
  projectId: string,
  project: Pick<Project, 'chatStores'> | null | undefined
): Promise<FollowUpAdmission> {
  const status: LegacyChatRuntimeStatus =
    (await fetchGet(`/chat/${encodeURIComponent(projectId)}/status`)) ?? {};
  if (isLegacyRuntimeBusy(status)) return 'busy';

  const taskIds = Object.values(project?.chatStores ?? {}).flatMap((store) =>
    Object.keys(store.getState().tasks)
  );
  if (
    status.consumer_alive &&
    (status.subscriber_count ?? 0) > 0 &&
    getIdleSSETransportTaskId(taskIds) === status.run_id
  )
    return 'warm';

  // Let a completed Run finish rendering the frames Brain already sent.
  await waitForIdleSSEDisplayTail(taskIds);
  if (
    status.consumer_alive &&
    !(await retireIdleLegacyRuntime(projectId, status.run_id))
  ) {
    throw new Error(
      i18next.t('chat.task-admission-failed', {
        defaultValue: 'The task could not be started. Please try again.',
      })
    );
  }
  closeIdleSSEConnectionsForTasks(taskIds);
  return 'cold';
}
