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

const MAX_SAVED_ACCOUNTS = 5;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SavedAccount {
  email: string;
  password?: string;
}

export interface PrefillCredentials {
  email: string;
  password?: string;
}

interface SavedLoginState {
  accounts: SavedAccount[];
  lastUsedEmail: string | null;

  addSavedAccount: (
    email: string,
    options?: { password?: string; rememberPassword?: boolean }
  ) => { success: true } | { success: false; error: string };
  removeSavedAccount: (email: string) => void;
  getSavedAccounts: () => SavedAccount[];
  getAccountByEmail: (email: string) => SavedAccount | undefined;
  getLastUsedPrefill: () => PrefillCredentials | null;
  setLastUsedEmail: (email: string) => void;
  reset: () => void;
}

function validateEmail(email: string): boolean {
  if (typeof email !== 'string' || !email.trim()) return false;
  return EMAIL_REGEX.test(email.trim());
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const savedLoginStore = create<SavedLoginState>()(
  persist(
    (set, get) => ({
      accounts: [],
      lastUsedEmail: null,

      addSavedAccount(email, options = {}) {
        const normalized = normalizeEmail(email);
        if (!validateEmail(normalized)) {
          return { success: false, error: 'Invalid email' };
        }

        const { password, rememberPassword } = options;
        if (rememberPassword && password !== undefined) {
          if (password.length < MIN_PASSWORD_LENGTH) {
            return {
              success: false,
              error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
            };
          }
        }

        set((state) => {
          const existing = state.accounts.find(
            (a) => normalizeEmail(a.email) === normalized
          );
          const accountsWithoutThis = state.accounts.filter(
            (a) => normalizeEmail(a.email) !== normalized
          );
          const updated: SavedAccount = {
            email: normalized,
            password:
              rememberPassword && password && password.length >= MIN_PASSWORD_LENGTH
                ? password
                : undefined,
          };
          const accounts = [updated, ...accountsWithoutThis].slice(
            0,
            MAX_SAVED_ACCOUNTS
          );
          return {
            accounts,
            lastUsedEmail: normalized,
          };
        });
        return { success: true };
      },

      removeSavedAccount(email: string) {
        const normalized = normalizeEmail(email);
        set((state) => ({
          accounts: state.accounts.filter(
            (a) => normalizeEmail(a.email) !== normalized
          ),
          lastUsedEmail:
            state.lastUsedEmail === normalized ? null : state.lastUsedEmail,
        }));
      },

      getSavedAccounts() {
        return get().accounts;
      },

      getAccountByEmail(email: string) {
        const normalized = normalizeEmail(email);
        return get().accounts.find(
          (a) => normalizeEmail(a.email) === normalized
        );
      },

      getLastUsedPrefill(): PrefillCredentials | null {
        const { accounts, lastUsedEmail } = get();
        if (!lastUsedEmail) {
          const first = accounts[0];
          return first ? { email: first.email, password: first.password } : null;
        }
        const match = accounts.find(
          (a) => normalizeEmail(a.email) === lastUsedEmail
        );
        return match
          ? { email: match.email, password: match.password }
          : { email: lastUsedEmail, password: undefined };
      },

      setLastUsedEmail(email: string) {
        if (!validateEmail(email)) return;
        set({ lastUsedEmail: normalizeEmail(email) });
      },

      reset() {
        set({ accounts: [], lastUsedEmail: null });
      },
    }),
    {
      name: 'saved-login-storage',
      partialize: (state) => ({
        accounts: state.accounts,
        lastUsedEmail: state.lastUsedEmail,
      }),
    }
  )
);

export const useSavedLoginStore = savedLoginStore;
export const getSavedLoginStore = () => savedLoginStore.getState();
