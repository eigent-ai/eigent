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

import { getBaseURL } from '@/api/http';
import { fetchWorkspaceConfiguration } from '@/service/workspaceConfigurationApi';
import { useAuthStore } from '@/store/authStore';
import {
  SkillSignInRequiredError,
  useSkillsStore,
  type Skill,
} from '@/store/skillsStore';
import {
  isUnconfiguredPlaceholderSpace,
  useSpaceStore,
} from '@/store/spaceStore';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import SkillDeleteDialog from './components/SkillDeleteDialog';
import SkillUploadDialog from './components/SkillUploadDialog';
import { buildSkillLibrary, type SpaceSkillProfile } from './skillLibrary';

type SkillLibraryLoadError = {
  key:
    | 'agents.library-global-load-failed'
    | 'agents.library-space-load-failed'
    | 'agents.library-sign-in';
  name?: string;
};

/**
 * A save that failed only because nobody is signed in gets the actionable
 * prompt; everything else gets the generic retry message.
 */
function saveErrorKey(error: unknown) {
  return error instanceof SkillSignInRequiredError
    ? 'agents.library-sign-in-to-save'
    : 'agents.library-save-failed';
}

function useLibrary(active: boolean) {
  const { t } = useTranslation();
  const skills = useSkillsStore((state) => state.skills);
  const syncFromDisk = useSkillsStore((state) => state.syncFromDisk);
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const spacesById = useSpaceStore((state) => state.spaces);
  const projectsBySpaceId = useSpaceStore((state) => state.projectsBySpaceId);
  const spaces = useMemo(
    () =>
      Object.values(spacesById)
        .filter(
          (space) =>
            space.status !== 'archived' &&
            space.sourceType !== 'legacy' &&
            !isUnconfiguredPlaceholderSpace(space, projectsBySpaceId)
        )
        .sort((a, b) => a.id.localeCompare(b.id)),
    [spacesById, projectsBySpaceId]
  );
  const spacesKey = JSON.stringify(
    spaces.map(({ id, name }) => ({ id, name }))
  );
  const [profiles, setProfiles] = useState<SpaceSkillProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const [errors, setErrors] = useState<SkillLibraryLoadError[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [previewGeneration, setPreviewGeneration] = useState(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [uploadMode, setUploadMode] = useState<'upload' | 'create' | null>(
    null
  );
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const refresh = useCallback(() => {
    if (loadingRef.current || pendingRef.current.size) return;
    setRefreshKey((value) => value + 1);
  }, []);
  const notifyPackageWrite = useCallback(() => {
    setPreviewGeneration((value) => value + 1);
  }, []);
  const openSkillDialog = useCallback((mode: 'upload' | 'create') => {
    if (loadingRef.current || pendingRef.current.size) return false;
    setUploadMode(mode);
    return true;
  }, []);
  const openUpload = useCallback(() => {
    openSkillDialog('upload');
  }, [openSkillDialog]);
  const requestDelete = useCallback((skill: Skill | null) => {
    if (skill && (loadingRef.current || pendingRef.current.size)) return;
    setDeleteTarget(skill);
  }, []);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!active) {
      // Any load still in flight belongs to a superseded generation and will
      // bail at its own guard, so the section is idle from here on.
      loadingRef.current = false;
      setLoading(false);
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setErrors([]);
    setProfiles([]);
    const load = async () => {
      const failures: SkillLibraryLoadError[] = [];
      const loaded: SpaceSkillProfile[] = [];
      const globalLoad = getBaseURL()
        .then(() => syncFromDisk())
        .catch(() => {
          failures.push({ key: 'agents.library-global-load-failed' });
        });
      const queue = JSON.parse(spacesKey) as Array<{
        id: string;
        name: string;
      }>;
      if (email) {
        await Promise.all(
          Array.from({ length: Math.min(queue.length, 3) }, async () => {
            while (queue.length && generation.current === current) {
              const space = queue.shift()!;
              try {
                const draft = await fetchWorkspaceConfiguration(
                  space.id,
                  { email, userId },
                  space.name
                );
                loaded.push({ space, draft });
              } catch {
                failures.push({
                  key: 'agents.library-space-load-failed',
                  name: space.name,
                });
              }
            }
          })
        );
      } else if (queue.length) {
        failures.push({ key: 'agents.library-sign-in' });
      }
      await globalLoad;
      if (generation.current !== current) return;
      setProfiles(loaded);
      setErrors(failures);
      loadingRef.current = false;
      setLoading(false);
    };
    void load();
    return () => {
      generation.current += 1;
    };
  }, [active, email, userId, spacesKey, syncFromDisk, refreshKey]);

  /**
   * Saves one skill and reports the outcome without raising a toast.
   * `skipped` means a refresh or an earlier save for the same skill was
   * already running — nothing was attempted, so it is not a failure.
   */
  const runUpdate = useCallback(
    async (
      skill: Skill,
      updates: Partial<Skill>
    ): Promise<
      | { status: 'ok' }
      | { status: 'skipped' }
      | { status: 'failed'; error: unknown }
    > => {
      if (loadingRef.current || pendingRef.current.has(skill.id))
        return { status: 'skipped' };
      pendingRef.current.add(skill.id);
      setPendingIds(new Set(pendingRef.current));
      try {
        await useSkillsStore.getState().updateSkill(skill.id, updates);
        return { status: 'ok' };
      } catch (error) {
        return { status: 'failed', error };
      } finally {
        pendingRef.current.delete(skill.id);
        setPendingIds(new Set(pendingRef.current));
      }
    },
    []
  );

  const updateGlobal = useCallback(
    async (skill: Skill, updates: Partial<Skill>) => {
      const result = await runUpdate(skill, updates);
      if (result.status === 'failed')
        toast.error(t(saveErrorKey(result.error)));
      return result.status === 'ok';
    },
    [runUpdate, t]
  );

  /**
   * Bulk enable/disable. Saves one skill at a time so each write lands on
   * the latest config; older backends still lose updates if these overlap.
   * Failures collapse into one toast instead of one per selected skill.
   */
  const updateGlobalMany = useCallback(
    async (targets: Skill[], updates: Partial<Skill>) => {
      if (!targets.length) return;
      const failures: unknown[] = [];
      for (const skill of targets) {
        const result = await runUpdate(skill, updates);
        if (result.status === 'failed') failures.push(result.error);
      }
      if (failures.length) toast.error(t(saveErrorKey(failures[0])));
    },
    [runUpdate, t]
  );

  const entries = useMemo(
    () => buildSkillLibrary(skills, profiles),
    [skills, profiles]
  );
  const messages = useMemo(
    () => errors.map(({ key, name }) => t(key, { name })),
    [errors, t]
  );

  // Memoised so the context value keeps its identity: every table row consumes
  // this, and a new object each render re-renders all of them.
  return useMemo(
    () => ({
      entries,
      spaces,
      loading,
      errors: messages,
      refresh,
      refreshKey,
      previewGeneration,
      notifyPackageWrite,
      pendingIds,
      updateGlobal,
      updateGlobalMany,
      uploadMode,
      setUploadMode,
      openSkillDialog,
      openUpload,
      deleteTarget,
      setDeleteTarget: requestDelete,
    }),
    [
      entries,
      spaces,
      loading,
      messages,
      refresh,
      refreshKey,
      previewGeneration,
      notifyPackageWrite,
      pendingIds,
      updateGlobal,
      updateGlobalMany,
      uploadMode,
      openSkillDialog,
      openUpload,
      deleteTarget,
      requestDelete,
    ]
  );
}

type SkillsLibrary = ReturnType<typeof useLibrary>;
const SkillsContext = createContext<SkillsLibrary | null>(null);
export function useSkillsLibrary() {
  const value = useContext(SkillsContext);
  if (!value) throw new Error('SkillsProvider is required');
  return value;
}

export function SkillsProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  const value = useLibrary(active);
  const { openSkillDialog, loading, pendingIds } = value;
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!active) return;
    const action = params.get('skillAction');
    if (action !== 'upload' && action !== 'create') return;
    if (!openSkillDialog(action)) return;
    const next = new URLSearchParams(params);
    next.delete('skillAction');
    setParams(next, { replace: true });
  }, [active, params, setParams, openSkillDialog, loading, pendingIds]);
  return (
    <SkillsContext.Provider value={value}>
      {children}
      <SkillUploadDialog
        open={value.uploadMode !== null}
        mode={value.uploadMode ?? 'upload'}
        onClose={() => value.setUploadMode(null)}
        onPackageWritten={value.notifyPackageWrite}
      />
      <SkillDeleteDialog
        open={Boolean(value.deleteTarget)}
        skill={value.deleteTarget}
        onCancel={() => value.setDeleteTarget(null)}
        onConfirm={() => {
          const deletedSkill = value.deleteTarget;
          value.setDeleteTarget(null);
          if (
            deletedSkill &&
            params.get('skillId') ===
              `global:${deletedSkill.skillDirName || deletedSkill.id}`
          ) {
            const next = new URLSearchParams(params);
            next.delete('skillId');
            setParams(next, { replace: true });
          }
        }}
      />
    </SkillsContext.Provider>
  );
}
