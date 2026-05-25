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
import type { SessionSidePanelData } from '@web/types';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, FileText, X } from 'lucide-react';

export function SessionSidePanel({
  data,
  loading,
  onClose,
}: {
  data: SessionSidePanelData | null;
  loading?: boolean;
  onClose?: () => void;
}) {
  if (!data && !loading) {
    return (
      <aside className="w-80 rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 text-body-sm text-ds-text-neutral-muted-default lg:block hidden shrink-0 border border-dashed">
        Session details appear here when a session is selected.
      </aside>
    );
  }

  return (
    <aside className="rounded-xl border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default lg:w-80 flex w-full shrink-0 flex-col border">
      <div className="border-ds-border-neutral-subtle-disabled p-4 flex items-center justify-between border-b">
        <h3 className="text-heading-sm font-semibold text-ds-text-neutral-default-default">
          Session details
        </h3>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close session panel"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="p-4 text-body-sm text-ds-text-neutral-muted-default">
          Loading session details…
        </div>
      ) : data ? (
        <div className="space-y-4 p-4 flex-1 overflow-y-auto">
          <section>
            <div className="mb-1 text-body-sm font-medium text-ds-text-neutral-muted-default">
              Status
            </div>
            <div className="text-body-md text-ds-text-neutral-default-default capitalize">
              {data.status}
            </div>
          </section>

          <section>
            <div className="mb-1 text-body-sm font-medium text-ds-text-neutral-muted-default">
              Tokens
            </div>
            <div className="text-body-md text-ds-text-neutral-default-default">
              {data.tokens.toLocaleString()}
            </div>
          </section>

          {data.createdAt ? (
            <section>
              <div className="mb-1 text-body-sm font-medium text-ds-text-neutral-muted-default">
                Started
              </div>
              <div className="text-body-md text-ds-text-neutral-default-default">
                {formatDistanceToNow(new Date(data.createdAt), {
                  addSuffix: true,
                })}
              </div>
            </section>
          ) : null}

          {data.errorMessage ? (
            <section className="rounded-lg bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-default-default">
              {data.errorMessage}
            </section>
          ) : null}

          <section>
            <div className="mb-2 text-body-sm font-medium text-ds-text-neutral-muted-default">
              Timeline
            </div>
            {data.timeline.length === 0 ? (
              <p className="text-body-sm text-ds-text-neutral-muted-default">
                No progress events yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.timeline.slice(0, 20).map((item) => (
                  <li
                    key={item.id}
                    className="rounded-lg bg-ds-bg-neutral-subtle-default p-2 text-body-sm"
                  >
                    <div className="font-medium text-ds-text-neutral-default-default">
                      {item.label}
                    </div>
                    {item.detail ? (
                      <div className="mt-1 text-ds-text-neutral-muted-default line-clamp-3">
                        {item.detail}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.resultFiles.length > 0 ? (
            <section>
              <div className="mb-2 text-body-sm font-medium text-ds-text-neutral-muted-default">
                Result files
              </div>
              <ul className="space-y-2">
                {data.resultFiles.map((file) => (
                  <li key={file.url}>
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="gap-2 text-body-sm text-ds-text-brand-default-default inline-flex items-center hover:underline"
                    >
                      <FileText className="h-4 w-4" />
                      {file.filename}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data.snapshots.length > 0 ? (
            <section>
              <div className="mb-2 text-body-sm font-medium text-ds-text-neutral-muted-default">
                Snapshots
              </div>
              <div className="gap-2 grid">
                {data.snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="rounded-lg border-ds-border-neutral-subtle-disabled overflow-hidden border"
                  >
                    {snapshot.imageUrl ? (
                      <img
                        src={snapshot.imageUrl}
                        alt="Session snapshot"
                        className="h-auto w-full object-cover"
                      />
                    ) : (
                      <div className="p-3 text-body-sm text-ds-text-neutral-muted-default">
                        Snapshot #{snapshot.id}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
