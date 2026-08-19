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
  fetchWorkspaceConfiguration,
  saveWorkspaceConfiguration,
  type WorkspaceConfigurationDocument,
  type WorkspaceConfigurationDraft,
  type WorkspaceConfigurationIdentity,
} from '@/service/workspaceConfigurationApi';
import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkspaceConfigurationSaveState =
  'idle' | 'loading' | 'saving' | 'saved' | 'needs_attention';

interface UseWorkspaceConfigurationInput {
  spaceId: string | null;
  spaceName?: string;
  identity: WorkspaceConfigurationIdentity | null;
  autosaveDelayMs?: number;
}

export function useWorkspaceConfiguration({
  spaceId,
  spaceName,
  identity,
  autosaveDelayMs = 700,
}: UseWorkspaceConfigurationInput) {
  const [draft, setDraft] = useState<WorkspaceConfigurationDraft | null>(null);
  const [document, setDocumentState] =
    useState<WorkspaceConfigurationDocument | null>(null);
  const [saveState, setSaveState] =
    useState<WorkspaceConfigurationSaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const loadGenerationRef = useRef(0);
  const versionRef = useRef(0);
  const baseRevisionRef = useRef<string | null>(null);
  const documentRef = useRef<WorkspaceConfigurationDocument | null>(null);
  const persistedDocumentRef = useRef('');
  const lastQueuedRef = useRef('');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(new Map<number, number>());
  const autosaveTimerRef = useRef<number | null>(null);
  const identityEmail = identity?.email ?? null;
  const identityUserId = identity?.userId ?? null;

  const refreshHasPendingChanges = useCallback(() => {
    const generation = loadGenerationRef.current;
    const pendingSaveCount = pendingSavesRef.current.get(generation) ?? 0;
    const currentDocument = documentRef.current;
    const documentChanged =
      currentDocument !== null &&
      JSON.stringify(currentDocument) !== persistedDocumentRef.current;
    setHasPendingChanges(pendingSaveCount > 0 || documentChanged);
  }, []);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current === null) return;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
  }, []);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!spaceId || !identityEmail) {
      setDraft(null);
      setDocumentState(null);
      documentRef.current = null;
      persistedDocumentRef.current = '';
      lastQueuedRef.current = '';
      setSaveState('idle');
      setError(null);
      setHasPendingChanges(false);
      return;
    }
    setSaveState('loading');
    setError(null);
    setHasPendingChanges(false);
    try {
      const loaded = await fetchWorkspaceConfiguration(
        spaceId,
        { email: identityEmail, userId: identityUserId },
        spaceName
      );
      if (generation !== loadGenerationRef.current) return;
      versionRef.current = loaded.version;
      baseRevisionRef.current = loaded.base_revision_id;
      documentRef.current = loaded.document;
      const serialized = JSON.stringify(loaded.document);
      persistedDocumentRef.current = serialized;
      lastQueuedRef.current = serialized;
      setDraft(loaded);
      setDocumentState(loaded.document);
      setSaveState(loaded.persisted ? 'saved' : 'idle');
      setHasPendingChanges(false);
    } catch (cause) {
      if (generation !== loadGenerationRef.current) return;
      setSaveState('needs_attention');
      setError(cause instanceof Error ? cause.message : String(cause));
      setHasPendingChanges(false);
    }
  }, [identityEmail, identityUserId, spaceId, spaceName]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const enqueueSave = useCallback(
    (candidate: WorkspaceConfigurationDocument): Promise<boolean> => {
      if (!spaceId || !identityEmail) return Promise.resolve(false);
      const generation = loadGenerationRef.current;
      const serialized = JSON.stringify(candidate);
      if (serialized === lastQueuedRef.current) {
        return saveQueueRef.current.then(() => {
          if (generation !== loadGenerationRef.current) return false;
          refreshHasPendingChanges();
          return serialized === persistedDocumentRef.current;
        });
      }
      lastQueuedRef.current = serialized;
      pendingSavesRef.current.set(
        generation,
        (pendingSavesRef.current.get(generation) ?? 0) + 1
      );
      refreshHasPendingChanges();

      const operation = saveQueueRef.current.then(async () => {
        try {
          if (generation !== loadGenerationRef.current) return false;
          setSaveState('saving');
          setError(null);
          try {
            const saved = await saveWorkspaceConfiguration(
              spaceId,
              { email: identityEmail, userId: identityUserId },
              {
                expectedVersion: versionRef.current,
                baseRevisionId: baseRevisionRef.current,
                document: candidate,
                updatedBy:
                  identityUserId === null
                    ? identityEmail
                    : String(identityUserId),
              }
            );
            if (generation !== loadGenerationRef.current) return false;
            versionRef.current = saved.version;
            baseRevisionRef.current = saved.base_revision_id;
            persistedDocumentRef.current = serialized;
            setDraft(saved);
            const currentDocument = documentRef.current;
            const isCurrentDocument =
              currentDocument !== null &&
              JSON.stringify(currentDocument) === serialized;
            const pendingSaveCount =
              pendingSavesRef.current.get(generation) ?? 1;
            setSaveState(
              isCurrentDocument && pendingSaveCount === 1 ? 'saved' : 'saving'
            );
            return true;
          } catch (cause) {
            if (generation !== loadGenerationRef.current) return false;
            setSaveState('needs_attention');
            setError(cause instanceof Error ? cause.message : String(cause));
            return false;
          }
        } finally {
          const remaining = (pendingSavesRef.current.get(generation) ?? 1) - 1;
          if (remaining > 0) {
            pendingSavesRef.current.set(generation, remaining);
          } else {
            pendingSavesRef.current.delete(generation);
          }
          if (generation === loadGenerationRef.current) {
            refreshHasPendingChanges();
          }
        }
      });

      saveQueueRef.current = operation.then(() => undefined);
      return operation;
    },
    [identityEmail, identityUserId, refreshHasPendingChanges, spaceId]
  );

  useEffect(() => {
    if (!document) return;
    const timer = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void enqueueSave(document);
    }, autosaveDelayMs);
    autosaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autosaveTimerRef.current === timer) {
        autosaveTimerRef.current = null;
      }
    };
  }, [autosaveDelayMs, document, enqueueSave]);

  const setDocument = useCallback(
    (
      next:
        | WorkspaceConfigurationDocument
        | ((
            current: WorkspaceConfigurationDocument
          ) => WorkspaceConfigurationDocument)
    ) => {
      const current = documentRef.current;
      if (!current) return;
      const resolved = typeof next === 'function' ? next(current) : next;
      documentRef.current = resolved;
      setDocumentState(resolved);
      refreshHasPendingChanges();
    },
    [refreshHasPendingChanges]
  );

  const flushSave = useCallback(async (): Promise<boolean> => {
    clearAutosaveTimer();
    const generation = loadGenerationRef.current;

    while (generation === loadGenerationRef.current) {
      const candidate = documentRef.current;
      if (!candidate) {
        refreshHasPendingChanges();
        return true;
      }
      const serialized = JSON.stringify(candidate);

      await enqueueSave(candidate);
      if (generation !== loadGenerationRef.current) return false;

      await saveQueueRef.current;
      if (generation !== loadGenerationRef.current) return false;

      const latestDocument = documentRef.current;
      if (!latestDocument) {
        refreshHasPendingChanges();
        return true;
      }
      const latestSerialized = JSON.stringify(latestDocument);
      if (latestSerialized !== serialized) {
        clearAutosaveTimer();
        continue;
      }

      const pendingSaveCount = pendingSavesRef.current.get(generation) ?? 0;
      refreshHasPendingChanges();
      if (pendingSaveCount > 0) continue;
      return serialized === persistedDocumentRef.current;
    }

    return false;
  }, [clearAutosaveTimer, enqueueSave, refreshHasPendingChanges]);

  const retrySave = useCallback(() => {
    if (!documentRef.current) return;
    lastQueuedRef.current = '';
    void enqueueSave(documentRef.current);
  }, [enqueueSave]);

  return {
    draft,
    document,
    setDocument,
    saveState,
    error,
    hasPendingChanges,
    flushSave,
    reload: load,
    retrySave,
  };
}
