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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TeachFeedbackSourceType =
  | 'agent-log'
  | 'run'
  | 'artifact'
  | 'file'
  | 'browser'
  | 'review'
  | 'terminal'
  | 'session';

export interface TeachFeedbackTarget {
  spaceId: string;
  projectId: string;
  runId?: string;
  sourceType: TeachFeedbackSourceType;
  sourceId: string;
  contextLabel: string;
  contextDetail?: string;
  sourcePath?: string;
  selectedText?: string;
}

export interface TeachFileReference {
  projectId: string;
  relativePath: string;
  name: string;
  token: string;
}

export interface TeachFeedback extends TeachFeedbackTarget {
  id: string;
  comment: string;
  fileReferences?: TeachFileReference[];
  createdAt: number;
  updatedAt: number;
}

interface TeachModeState {
  enabled: boolean;
  feedbackById: Record<string, TeachFeedback>;
  draftAnnotationIdsByProjectId: Record<string, string[]>;
  pendingAnnotation: TeachFeedbackTarget | null;
  setEnabled: (enabled: boolean) => void;
  setPendingAnnotation: (target: TeachFeedbackTarget | null) => void;
  addAnnotation: (
    target: TeachFeedbackTarget,
    comment: string,
    fileReferences?: TeachFileReference[]
  ) => void;
  updateAnnotation: (
    id: string,
    comment: string,
    fileReferences?: TeachFileReference[]
  ) => void;
  deleteAnnotation: (id: string) => void;
  removeDraftAnnotation: (projectId: string, id: string) => void;
  clearDraftAnnotations: (projectId: string, ids: string[]) => void;
  saveFeedback: (
    target: TeachFeedbackTarget,
    update: { comment: string; fileReferences?: TeachFileReference[] }
  ) => void;
}

export function teachFeedbackId(target: TeachFeedbackTarget): string {
  return [
    target.spaceId,
    target.projectId,
    target.runId ?? '',
    target.sourceType,
    target.sourceId,
  ].join(':');
}

export const useTeachModeStore = create<TeachModeState>()(
  persist(
    (set) => ({
      enabled: false,
      feedbackById: {},
      draftAnnotationIdsByProjectId: {},
      pendingAnnotation: null,
      setEnabled: (enabled) => set({ enabled }),
      setPendingAnnotation: (pendingAnnotation) => set({ pendingAnnotation }),
      addAnnotation: (target, comment, fileReferences = []) =>
        set((state) => {
          const body = comment.trim();
          if (!body) return state;
          const id = `annotation:${crypto.randomUUID()}`;
          const now = Date.now();
          return {
            feedbackById: {
              ...state.feedbackById,
              [id]: {
                ...target,
                id,
                comment: body,
                fileReferences: fileReferences.filter((reference) =>
                  body.includes(reference.token)
                ),
                createdAt: now,
                updatedAt: now,
              },
            },
            draftAnnotationIdsByProjectId: {
              ...state.draftAnnotationIdsByProjectId,
              [target.projectId]: [
                ...(state.draftAnnotationIdsByProjectId[target.projectId] ??
                  []),
                id,
              ],
            },
          };
        }),
      updateAnnotation: (id, comment, fileReferences = []) =>
        set((state) => {
          const entry = state.feedbackById[id];
          const body = comment.trim();
          if (!entry || !body) return state;
          return {
            feedbackById: {
              ...state.feedbackById,
              [id]: {
                ...entry,
                comment: body,
                fileReferences: fileReferences.filter((reference) =>
                  body.includes(reference.token)
                ),
                updatedAt: Date.now(),
              },
            },
          };
        }),
      deleteAnnotation: (id) =>
        set((state) => {
          if (!state.feedbackById[id]) return state;
          const feedbackById = { ...state.feedbackById };
          delete feedbackById[id];
          const projectId = state.feedbackById[id].projectId;
          return {
            feedbackById,
            draftAnnotationIdsByProjectId: {
              ...state.draftAnnotationIdsByProjectId,
              [projectId]: (
                state.draftAnnotationIdsByProjectId[projectId] ?? []
              ).filter((draftId) => draftId !== id),
            },
          };
        }),
      removeDraftAnnotation: (projectId, id) =>
        set((state) => ({
          draftAnnotationIdsByProjectId: {
            ...state.draftAnnotationIdsByProjectId,
            [projectId]: (
              state.draftAnnotationIdsByProjectId[projectId] ?? []
            ).filter((draftId) => draftId !== id),
          },
        })),
      clearDraftAnnotations: (projectId, ids) =>
        set((state) => {
          const sentIds = new Set(ids);
          return {
            draftAnnotationIdsByProjectId: {
              ...state.draftAnnotationIdsByProjectId,
              [projectId]: (
                state.draftAnnotationIdsByProjectId[projectId] ?? []
              ).filter((id) => !sentIds.has(id)),
            },
          };
        }),
      saveFeedback: (target, update) =>
        set((state) => {
          const id = teachFeedbackId(target);
          const comment = update.comment.trim();
          if (!comment) {
            const feedbackById = { ...state.feedbackById };
            delete feedbackById[id];
            return { feedbackById };
          }
          const now = Date.now();
          const next: TeachFeedback = {
            ...target,
            id,
            comment,
            fileReferences: (update.fileReferences ?? []).filter((reference) =>
              comment.includes(reference.token)
            ),
            createdAt: state.feedbackById[id]?.createdAt ?? now,
            updatedAt: now,
          };
          return {
            feedbackById: {
              ...state.feedbackById,
              [id]: next,
            },
          };
        }),
    }),
    {
      name: 'eigent-teach-mode',
      version: 3,
      migrate: (persistedState, version) => {
        if (!persistedState) return persistedState;
        if (version >= 2) {
          return {
            ...persistedState,
            draftAnnotationIdsByProjectId:
              (persistedState as Partial<TeachModeState>)
                .draftAnnotationIdsByProjectId ?? {},
          };
        }
        const previous = persistedState as {
          enabled?: boolean;
          enabledBySpaceId?: Record<string, boolean>;
          feedbackById?: Record<string, Partial<TeachFeedback>>;
        };
        const feedbackById = Object.fromEntries(
          Object.entries(previous.feedbackById ?? {}).flatMap(([id, entry]) => {
            const comment = entry.comment?.trim();
            if (!comment) return [];
            const sourceType = entry.sourceType ?? 'run';
            return [
              [
                id,
                {
                  ...entry,
                  id,
                  comment,
                  contextLabel:
                    entry.contextLabel ??
                    (sourceType === 'agent-log' ? 'Agent log' : 'Whole run'),
                  createdAt: entry.createdAt ?? entry.updatedAt ?? Date.now(),
                },
              ],
            ];
          })
        );
        return {
          enabled:
            version < 1
              ? (previous.enabled ??
                Object.values(previous.enabledBySpaceId ?? {}).some(Boolean))
              : (previous.enabled ?? false),
          feedbackById,
          draftAnnotationIdsByProjectId: {},
        };
      },
      partialize: (state) => ({
        enabled: state.enabled,
        feedbackById: state.feedbackById,
        draftAnnotationIdsByProjectId: state.draftAnnotationIdsByProjectId,
      }),
    }
  )
);
