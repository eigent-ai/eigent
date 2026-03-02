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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getSavedLoginStore,
  useSavedLoginStore,
} from '../../../src/store/savedLoginStore';

describe('SavedLoginStore', () => {
  beforeEach(() => {
    getSavedLoginStore().reset();
  });

  afterEach(() => {
    getSavedLoginStore().reset();
  });

  describe('addSavedAccount', () => {
    it('adds an account with email only', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      let outcome: { success: true } | { success: false; error: string };
      act(() => {
        outcome = result.current.addSavedAccount('user@example.com');
      });
      expect(outcome!).toEqual({ success: true });
      expect(result.current.getSavedAccounts()).toHaveLength(1);
      expect(result.current.getSavedAccounts()[0]).toEqual({
        email: 'user@example.com',
        password: undefined,
      });
    });

    it('adds an account with email and password when rememberPassword is true', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      let outcome: { success: true } | { success: false; error: string };
      act(() => {
        outcome = result.current.addSavedAccount('user@example.com', {
          password: 'password123',
          rememberPassword: true,
        });
      });
      expect(outcome!).toEqual({ success: true });
      expect(result.current.getAccountByEmail('user@example.com')).toEqual({
        email: 'user@example.com',
        password: 'password123',
      });
    });

    it('returns error for invalid email', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      expect(result.current.addSavedAccount('')).toEqual({
        success: false,
        error: 'Invalid email',
      });
      expect(result.current.addSavedAccount('not-an-email')).toEqual({
        success: false,
        error: 'Invalid email',
      });
    });

    it('returns error when password is too short and rememberPassword is true', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      expect(
        result.current.addSavedAccount('user@example.com', {
          password: 'short',
          rememberPassword: true,
        })
      ).toEqual({
        success: false,
        error: 'Password must be at least 8 characters',
      });
    });

    it('normalizes email to lowercase', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('User@Example.COM');
      });
      expect(result.current.getSavedAccounts()[0].email).toBe(
        'user@example.com'
      );
    });

    it('updates existing account and sets lastUsedEmail', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('a@b.com', {
          password: 'oldpass123',
          rememberPassword: true,
        });
        result.current.addSavedAccount('a@b.com', {
          password: 'newpass123',
          rememberPassword: true,
        });
      });
      expect(result.current.getSavedAccounts()).toHaveLength(1);
      expect(result.current.getAccountByEmail('a@b.com')?.password).toBe(
        'newpass123'
      );
      expect(result.current.getLastUsedPrefill()?.email).toBe('a@b.com');
    });
  });

  describe('removeSavedAccount', () => {
    it('removes account by email', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('user@example.com');
        result.current.removeSavedAccount('user@example.com');
      });
      expect(result.current.getSavedAccounts()).toHaveLength(0);
      expect(result.current.getAccountByEmail('user@example.com')).toBeUndefined();
    });

    it('clears lastUsedEmail when removing the last-used account', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('user@example.com');
        result.current.removeSavedAccount('user@example.com');
      });
      expect(result.current.getLastUsedPrefill()).toBeNull();
    });
  });

  describe('getLastUsedPrefill', () => {
    it('returns null when no accounts', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      expect(result.current.getLastUsedPrefill()).toBeNull();
    });

    it('returns last-added account as prefill when multiple exist', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('first@b.com');
        result.current.addSavedAccount('second@b.com');
      });
      const prefill = result.current.getLastUsedPrefill();
      expect(prefill?.email).toBe('second@b.com');
    });

    it('returns remaining account when last-used is removed', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      result.current.addSavedAccount('first@b.com');
      result.current.addSavedAccount('second@b.com');
      result.current.removeSavedAccount('second@b.com');
      const prefill = result.current.getLastUsedPrefill();
      expect(prefill?.email).toBe('first@b.com');
    });

    it('returns email and password for last-used account', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('user@example.com', {
          password: 'secret123',
          rememberPassword: true,
        });
      });
      const prefill = result.current.getLastUsedPrefill();
      expect(prefill).toEqual({
        email: 'user@example.com',
        password: 'secret123',
      });
    });
  });

  describe('setLastUsedEmail', () => {
    it('sets lastUsedEmail for valid email', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('a@b.com');
        result.current.addSavedAccount('b@b.com');
        result.current.setLastUsedEmail('a@b.com');
      });
      expect(result.current.getLastUsedPrefill()?.email).toBe('a@b.com');
    });

    it('ignores invalid email', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        result.current.addSavedAccount('valid@b.com');
        result.current.setLastUsedEmail('invalid');
      });
      expect(result.current.getLastUsedPrefill()?.email).toBe('valid@b.com');
    });
  });

  describe('max accounts cap', () => {
    it('keeps at most 5 accounts', () => {
      const { result } = renderHook(() => useSavedLoginStore());
      act(() => {
        for (let i = 0; i < 7; i++) {
          result.current.addSavedAccount(`user${i}@example.com`);
        }
      });
      expect(result.current.getSavedAccounts()).toHaveLength(5);
    });
  });
});
