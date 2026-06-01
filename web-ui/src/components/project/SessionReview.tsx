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

import { RemoteControls } from '@web/components/project/RemoteControls';
import type { WebSession } from '@web/types';

export function SessionReview({
  session,
  liveMessages,
  onControl,
}: {
  session: WebSession | null;
  liveMessages: string[];
  onControl?: () => void;
}) {
  if (!session) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-6 text-ds-text-neutral-muted-default">
        Select a session to review results and progress.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col rounded-xl border border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default">
      <div className="border-b border-ds-border-neutral-subtle-disabled p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-heading-sm font-semibold text-ds-text-neutral-default-default">
            Session review
          </h2>
          <RemoteControls session={session} onAction={onControl} />
        </div>
        <p className="text-body-md text-ds-text-neutral-default-default">
          {session.question}
        </p>
        {session.summary ? (
          <p className="mt-2 text-body-sm text-ds-text-neutral-muted-default">
            {session.summary}
          </p>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {liveMessages.length === 0 ? (
          <p className="text-body-sm text-ds-text-neutral-muted-default">
            {session.status === 'ongoing'
              ? 'Waiting for updates…'
              : 'No live messages for this session.'}
          </p>
        ) : (
          liveMessages.map((message, index) => (
            <div
              key={`${index}-${message.slice(0, 24)}`}
              className="whitespace-pre-wrap rounded-lg bg-ds-bg-neutral-subtle-default p-3 text-body-sm text-ds-text-neutral-default-default"
            >
              {message}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
