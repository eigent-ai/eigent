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
  fetchSpaceModelSelection,
  spaceModelError,
} from '@/lib/spaceModelBinding';
import { parseSpaceModelReference } from '@/lib/spaceModelReference';
import { errorCopy } from '@/lib/usageErrors';
import { getAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { useCallback, useEffect, useState } from 'react';

const quotaReasons = ['credits', 'trial-daily', 'trial-total', 'free-credits'];

function currentQuota() {
  const auth = getAuthStore();
  const usage = useUsageNoticeStore.getState();
  return auth.token &&
    auth.user_id != null &&
    usage.account === String(auth.user_id)
    ? usage.incidents.find((incident) => quotaReasons.includes(incident.reason))
    : undefined;
}

function contextSnapshot() {
  const auth = getAuthStore();
  const spaces = useSpaceStore.getState();
  const space = spaces.activeSpaceId
    ? spaces.spaces[spaces.activeSpaceId]
    : null;
  return {
    token: auth.token,
    email: auth.email,
    userId: auth.user_id,
    modelType: auth.modelType,
    cloudModel: auth.cloud_model_type,
    codexModel: auth.codex_model_type,
    spaceId: spaces.activeSpaceId,
    loadedSpaceId: space?.id,
    owner: space?.userId,
    source: space?.sourceType,
    status: space?.status,
  };
}

/** A category preview only: startup still resolves and admits the actual binding. */
export function useNewSessionModelQuota(
  spaceId: string | null,
  modelType: string
) {
  const usage = useUsageNoticeStore();
  const snapshot = contextSnapshot();
  const contextKey = JSON.stringify(snapshot);
  const quota = currentQuota();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const key = JSON.stringify([
    contextKey,
    spaceId,
    quota?.reason,
    usage.refreshing,
    refreshVersion,
  ]);
  const [preview, setPreview] = useState<{
    key: string;
    modelType?: string;
    error?: Error;
  } | null>(null);
  const needsPreview = Boolean(quota && spaceId);

  const assertCurrent = useCallback(() => {
    if (JSON.stringify(contextSnapshot()) !== contextKey)
      throw spaceModelError('changed');
  }, [contextKey]);
  const readCategory = useCallback(async () => {
    assertCurrent();
    if (!spaceId) return modelType;
    const requestContext = contextSnapshot();
    const selection = await fetchSpaceModelSelection(
      spaceId,
      { email: requestContext.email || '', userId: requestContext.userId },
      assertCurrent
    );
    if (selection === null || selection?.model_ref === 'provider://default')
      return requestContext.modelType;
    const identity =
      typeof selection?.model_ref === 'string'
        ? parseSpaceModelReference(selection.model_ref)
        : null;
    if (!identity) throw spaceModelError('unavailable');
    return identity.category;
  }, [assertCurrent, spaceId, modelType]);

  useEffect(() => {
    if (!needsPreview) return;
    let current = true;
    void readCategory().then(
      (resolvedModelType) => {
        if (current) setPreview({ key, modelType: resolvedModelType });
      },
      () => {
        if (current && JSON.stringify(contextSnapshot()) === contextKey)
          setPreview({ key, error: spaceModelError('unavailable') });
      }
    );
    return () => {
      current = false;
    };
  }, [key, needsPreview, readCategory, contextKey]);

  const pending = needsPreview && preview?.key !== key;
  const error =
    needsPreview && preview?.key === key ? preview.error : undefined;
  const effectiveModelType = needsPreview
    ? preview?.key === key
      ? preview.modelType
      : undefined
    : modelType;

  return {
    pending,
    error,
    effectiveModelType,
    isCurrentAccount: Boolean(
      snapshot.token &&
      snapshot.userId != null &&
      usage.account === String(snapshot.userId)
    ),
    blocked: Boolean(
      quota && (pending || error || effectiveModelType === 'cloud')
    ),
    refresh: () => setRefreshVersion((version) => version + 1),
    async beforeCreate() {
      assertCurrent();
      // Re-read on send: a mounted preview is not a launch snapshot or a pin.
      if (currentQuota()) {
        const category = await readCategory();
        assertCurrent();
        setPreview({ key, modelType: category });
        const currentBlock = currentQuota();
        if (category === 'cloud' && currentBlock)
          throw Object.assign(new Error(errorCopy(currentBlock.reason)), {
            usageReason: currentBlock.reason,
          });
      }
      assertCurrent();
      return assertCurrent;
    },
  };
}
