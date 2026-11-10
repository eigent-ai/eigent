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
// Licensed under the Apache License, Version 2.0 (the "License");

import {
  listMemoryEntries,
  updateMemoryScopeSettings,
  type MemoryScopeState,
} from '@/service/memoryApi';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Durable Project Memory setting backed by the local Brain/SQLite. */
export function useProjectMemorySetting(projectId: string | null) {
  const [scopeState, setScopeState] = useState<MemoryScopeState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!projectId) {
      setScopeState(null);
      setError(null);
      setLoading(false);
      return;
    }
    setScopeState(null);
    setLoading(true);
    setError(null);
    try {
      const response = await listMemoryEntries('project', projectId, false);
      if (requestGeneration === generation.current) {
        setScopeState(response.scope_state);
      }
    } catch (caught) {
      if (requestGeneration === generation.current) {
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  const toggle = useCallback(async () => {
    if (
      !projectId ||
      !scopeState ||
      scopeState.scope_id !== projectId ||
      loading
    ) {
      return;
    }
    const requestGeneration = generation.current;
    const previous = scopeState;
    const nextEnabled = !previous.use_enabled;
    setLoading(true);
    setError(null);
    setScopeState({ ...previous, use_enabled: nextEnabled });
    try {
      const updated = await updateMemoryScopeSettings('project', projectId, {
        expectedRevision: previous.revision,
        useEnabled: nextEnabled,
      });
      if (requestGeneration === generation.current) {
        setScopeState(updated);
      }
    } catch (caught) {
      if (requestGeneration === generation.current) {
        setScopeState(previous);
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      }
      throw caught;
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [loading, projectId, scopeState]);

  return {
    enabled: scopeState?.scope_id === projectId ? scopeState.use_enabled : true,
    available: scopeState?.scope_id === projectId,
    loading,
    error,
    reload,
    toggle,
  };
}
