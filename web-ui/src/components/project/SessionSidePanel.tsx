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
      <aside className="hidden w-80 shrink-0 rounded-xl border border-dashed border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default p-4 text-body-sm text-ds-text-neutral-muted-default lg:block">
        Session details appear here when a session is selected.
      </aside>
    );
  }

  return (
    <aside className="flex w-full shrink-0 flex-col rounded-xl border border-ds-border-neutral-subtle-disabled bg-ds-bg-neutral-default-default lg:w-80">
      <div className="flex items-center justify-between border-b border-ds-border-neutral-subtle-disabled p-4">
        <h3 className="text-heading-sm font-semibold text-ds-text-neutral-default-default">
          Session details
        </h3>
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            buttonRadius="full"
            aria-label="Close session panel"
            onClick={onClose}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="p-4 text-body-sm text-ds-text-neutral-muted-default">
          Loading session details…
        </div>
      ) : data ? (
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <section>
            <div className="mb-1 text-body-sm font-medium text-ds-text-neutral-muted-default">
              Status
            </div>
            <div className="text-body-md capitalize text-ds-text-neutral-default-default">
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
                      <div className="mt-1 line-clamp-3 text-ds-text-neutral-muted-default">
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
                      className="inline-flex items-center gap-2 text-body-sm text-ds-text-brand-default-default hover:underline"
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
              <div className="grid gap-2">
                {data.snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="overflow-hidden rounded-lg border border-ds-border-neutral-subtle-disabled"
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
