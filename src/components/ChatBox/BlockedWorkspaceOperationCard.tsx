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
import { DsText } from '@/components/ui/ds-text';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import {
  checkpointBlockedWorkspaceOperation,
  dismissBlockedWorkspaceOperation,
  fetchWorkspaceGitStatus,
  type WorkspaceBlockedOperation,
} from '@/service/workspaceGitApi';
import type { Space } from '@/store/spaceStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export type BlockedWorkspaceOperationAction = 'saving' | 'dismissing' | null;

interface BlockedWorkspaceOperationCardProps {
  operation: WorkspaceBlockedOperation;
  /** Other blocked operations in the same Space, shown as a count. */
  moreCount?: number;
  action: BlockedWorkspaceOperationAction;
  onSave: () => void;
  onDismiss: () => void;
}

/**
 * Explains why edits in a Git Space are paused and offers the two ways out.
 * Neither action re-runs the stopped Task's tool.
 */
export function BlockedWorkspaceOperationCard({
  operation,
  moreCount = 0,
  action,
  onSave,
  onDismiss,
}: BlockedWorkspaceOperationCardProps) {
  const { t } = useTranslation();
  const busy = action !== null;
  const description = operation.relative_path
    ? t('chat.workspace-blocked-description-file', {
        path: operation.relative_path,
      })
    : t('chat.workspace-blocked-description-process');
  return (
    <aside
      role="status"
      aria-live="polite"
      data-blocked-workspace-operation
      className="@container mb-ds-8 w-full rounded-ds-card border border-x border-y border-ds-border-warning-default-default bg-ds-bg-warning-subtle-default px-ds-16 py-ds-12 text-ds-text-warning-strong-default"
    >
      {/* Two long action labels: sit beside the text only once the card can
          also keep a readable text column (42rem); below that, stack. */}
      <div className="flex flex-col gap-ds-12 @2xl:flex-row @2xl:items-center">
        <div className="min-w-0 flex-1 break-words">
          <DsText role="base" weight="medium">
            {t('chat.workspace-blocked-title')}
          </DsText>
          <DsText role="base">{description}</DsText>
          {!operation.actionable && (
            <DsText as="p" role="meta">
              {t('chat.workspace-blocked-waiting')}
            </DsText>
          )}
          {moreCount > 0 && (
            <DsText as="p" role="meta">
              {t('chat.workspace-blocked-more', { count: moreCount })}
            </DsText>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-ds-control-gap self-end @2xl:self-center">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            tone="warning"
            disabled={busy || !operation.actionable}
            onClick={onDismiss}
          >
            {t(
              action === 'dismissing'
                ? 'chat.workspace-blocked-dismissing'
                : 'chat.workspace-blocked-dismiss'
            )}
          </Button>
          {operation.can_checkpoint && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              tone="warning"
              disabled={busy || !operation.actionable}
              onClick={onSave}
            >
              {t(
                action === 'saving'
                  ? 'chat.workspace-blocked-saving'
                  : 'chat.workspace-blocked-save'
              )}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}

interface BlockedWorkspaceOperationNoticeProps {
  space: Space | null | undefined;
  email: string | null | undefined;
  userId: string | number | null | undefined;
  /** Changes when a Task starts or stops, so a new block is noticed. */
  refreshKey?: string;
}

const visibleOperations = (
  operations: WorkspaceBlockedOperation[] | undefined
) =>
  (operations || []).filter(
    // A prepared operation of a running Task is ordinary in-flight work.
    (item) => item.actionable || item.status === 'needs_attention'
  );

/** Loads a Space's blocked workspace operations and renders the oldest. */
export function BlockedWorkspaceOperationNotice({
  space,
  email,
  userId,
  refreshKey,
}: BlockedWorkspaceOperationNoticeProps) {
  const { t } = useTranslation();
  const spaceId = space?.id ?? null;
  const supported = Boolean(
    spaceId &&
    space &&
    email &&
    !spaceId.startsWith('legacy_') &&
    isLocalWorkspaceSpace(space)
  );
  const [operations, setOperations] = useState<WorkspaceBlockedOperation[]>([]);
  const [action, setAction] = useState<BlockedWorkspaceOperationAction>(null);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    if (!supported || !spaceId || !email) {
      setOperations([]);
      return;
    }
    try {
      const status = await fetchWorkspaceGitStatus(spaceId, {
        email,
        userId,
      });
      if (request !== latestRequest.current) return;
      setOperations(visibleOperations(status.blocked_operations));
    } catch (error) {
      if (request !== latestRequest.current) return;
      console.warn(
        '[BlockedWorkspaceOperation] Failed to load workspace status:',
        error
      );
      setOperations([]);
    }
  }, [email, spaceId, supported, userId]);

  useEffect(() => {
    // Another Space's operations never apply here.
    setOperations([]);
  }, [spaceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!supported) return;
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load, supported]);

  const operation = operations[0];

  const resolve = useCallback(
    async (kind: 'save' | 'dismiss') => {
      if (!operation || !spaceId || !email || action) return;
      setAction(kind === 'save' ? 'saving' : 'dismissing');
      try {
        if (kind === 'save') {
          if (!operation.repo_state_digest) {
            throw new Error('missing repository state');
          }
          await checkpointBlockedWorkspaceOperation(
            spaceId,
            { email, userId },
            {
              intentId: operation.intent_id,
              operationRequestId: `user-resolve-${crypto.randomUUID()}`,
              expectedRepoStateDigest: operation.repo_state_digest,
            }
          );
          toast.success(t('chat.workspace-blocked-saved'));
        } else {
          await dismissBlockedWorkspaceOperation(
            spaceId,
            { email, userId },
            operation.intent_id
          );
          toast.success(t('chat.workspace-blocked-dismissed'));
        }
      } catch (error: any) {
        console.warn(
          '[BlockedWorkspaceOperation] Failed to resolve operation:',
          error
        );
        const code = error?.response?.data?.detail?.code;
        toast.error(
          t(
            code === 'repo_state_changed'
              ? 'chat.workspace-blocked-changed'
              : 'chat.workspace-blocked-failed'
          )
        );
      } finally {
        setAction(null);
        await load();
      }
    },
    [action, email, load, operation, spaceId, t, userId]
  );

  if (!operation) return null;
  return (
    <BlockedWorkspaceOperationCard
      operation={operation}
      moreCount={operations.length - 1}
      action={action}
      onSave={() => void resolve('save')}
      onDismiss={() => void resolve('dismiss')}
    />
  );
}
