import {
  fetchWorkspaceConfiguration,
  saveWorkspaceConfiguration,
  type WorkspaceConfigurationDocument,
  type WorkspaceConfigurationDraft,
  type WorkspaceConfigurationIdentity,
} from '@/service/workspaceConfigurationApi';
import { useCallback, useEffect, useRef, useState } from 'react';

export type WorkspaceConfigurationSaveState =
  | 'idle'
  | 'loading'
  | 'saving'
  | 'saved'
  | 'needs_attention';

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
  const loadGenerationRef = useRef(0);
  const versionRef = useRef(0);
  const baseRevisionRef = useRef<string | null>(null);
  const documentRef = useRef<WorkspaceConfigurationDocument | null>(null);
  const lastQueuedRef = useRef('');
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const identityEmail = identity?.email ?? null;
  const identityUserId = identity?.userId ?? null;

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!spaceId || !identityEmail) {
      setDraft(null);
      setDocumentState(null);
      documentRef.current = null;
      setSaveState('idle');
      setError(null);
      return;
    }
    setSaveState('loading');
    setError(null);
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
      lastQueuedRef.current = JSON.stringify(loaded.document);
      setDraft(loaded);
      setDocumentState(loaded.document);
      setSaveState(loaded.persisted ? 'saved' : 'idle');
    } catch (cause) {
      if (generation !== loadGenerationRef.current) return;
      setSaveState('needs_attention');
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [identityEmail, identityUserId, spaceId, spaceName]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const enqueueSave = useCallback(
    (candidate: WorkspaceConfigurationDocument) => {
      if (!spaceId || !identityEmail) return;
      const generation = loadGenerationRef.current;
      const serialized = JSON.stringify(candidate);
      if (serialized === lastQueuedRef.current) return;
      lastQueuedRef.current = serialized;
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        if (generation !== loadGenerationRef.current) return;
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
          if (generation !== loadGenerationRef.current) return;
          versionRef.current = saved.version;
          baseRevisionRef.current = saved.base_revision_id;
          setDraft(saved);
          setSaveState(documentRef.current === candidate ? 'saved' : 'saving');
        } catch (cause) {
          if (generation !== loadGenerationRef.current) return;
          setSaveState('needs_attention');
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    },
    [identityEmail, identityUserId, spaceId]
  );

  useEffect(() => {
    if (!document) return;
    const timer = window.setTimeout(
      () => enqueueSave(document),
      autosaveDelayMs
    );
    return () => window.clearTimeout(timer);
  }, [autosaveDelayMs, document, enqueueSave]);

  const setDocument = useCallback(
    (
      next:
        | WorkspaceConfigurationDocument
        | ((
            current: WorkspaceConfigurationDocument
          ) => WorkspaceConfigurationDocument)
    ) => {
      setDocumentState((current) => {
        if (!current) return current;
        const resolved = typeof next === 'function' ? next(current) : next;
        documentRef.current = resolved;
        return resolved;
      });
    },
    []
  );

  const retrySave = useCallback(() => {
    if (!documentRef.current) return;
    lastQueuedRef.current = '';
    enqueueSave(documentRef.current);
  }, [enqueueSave]);

  return {
    draft,
    document,
    setDocument,
    saveState,
    error,
    reload: load,
    retrySave,
  };
}
