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

import { getAuthEnvironmentKey } from '@/lib/authEnvironment';
import {
  fetchUserProfile,
  UnsupportedUserProfilePreferenceError,
  updateUserWorkRole,
  type UserProfile,
} from '@/service/userProfileApi';
import type { WorkRoleKey } from '@/types/exampleContent';
import { create } from 'zustand';

type ProfileLoadState = 'idle' | 'loading' | 'ready' | 'error';
export type WorkRoleSaveResult =
  | { saved: true }
  | { saved: false; reason: 'unsupported' | 'failed'; error: unknown };

interface UserProfileState {
  accountKey: string | null;
  environmentKey: string;
  profile: UserProfile | null;
  loadState: ProfileLoadState;
  requestGeneration: number;
  hydrate: (accountId: string | number) => Promise<void>;
  reset: () => void;
  saveWorkRole: (
    accountId: string | number,
    role: WorkRoleKey | null
  ) => Promise<WorkRoleSaveResult>;
}

const contextFor = (accountId: string | number) => ({
  accountKey: String(accountId),
  environmentKey: getAuthEnvironmentKey(),
});

export const useUserProfileStore = create<UserProfileState>((set, get) => ({
  accountKey: null,
  environmentKey: getAuthEnvironmentKey(),
  profile: null,
  loadState: 'idle',
  requestGeneration: 0,

  hydrate: async (accountId) => {
    const context = contextFor(accountId);
    const generation = get().requestGeneration + 1;
    set({
      ...context,
      profile: null,
      loadState: 'loading',
      requestGeneration: generation,
    });
    try {
      const profile = await fetchUserProfile();
      const current = get();
      if (
        current.requestGeneration !== generation ||
        current.accountKey !== context.accountKey ||
        current.environmentKey !== context.environmentKey
      ) {
        return;
      }
      set({ profile, loadState: 'ready' });
    } catch {
      const current = get();
      if (current.requestGeneration === generation) set({ loadState: 'error' });
    }
  },

  reset: () =>
    set((state) => ({
      accountKey: null,
      environmentKey: getAuthEnvironmentKey(),
      profile: null,
      loadState: 'idle',
      requestGeneration: state.requestGeneration + 1,
    })),

  saveWorkRole: async (accountId, role) => {
    const context = contextFor(accountId);
    const generation = get().requestGeneration + 1;
    set({ ...context, requestGeneration: generation });
    try {
      const profile = await updateUserWorkRole(role);
      const current = get();
      if (
        current.requestGeneration === generation &&
        current.accountKey === context.accountKey &&
        current.environmentKey === context.environmentKey
      ) {
        set({ profile, loadState: 'ready' });
        return { saved: true };
      }
      return {
        saved: false,
        reason: 'failed',
        error: new Error(
          'User profile context changed before the save completed.'
        ),
      };
    } catch (error) {
      const status = (error as { status?: number })?.status;
      return {
        saved: false,
        reason:
          error instanceof UnsupportedUserProfilePreferenceError ||
          status === 404 ||
          status === 405 ||
          status === 422
            ? 'unsupported'
            : 'failed',
        error,
      };
    }
  },
}));

export const getUserProfileStore = () => useUserProfileStore.getState();
