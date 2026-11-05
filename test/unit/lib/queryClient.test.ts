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

import { queryClient, queryKeys } from '@/lib/queryClient';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// queryClient instance
// ---------------------------------------------------------------------------
describe('queryClient', () => {
  it('is a QueryClient instance', () => {
    expect(queryClient).toBeInstanceOf(QueryClient);
  });

  it('has staleTime of 300000 (5 minutes)', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(300000);
  });

  it('has gcTime of 1800000 (30 minutes)', () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(1800000);
  });

  it('has retry set to 2', () => {
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(2);
  });

  it('has refetchOnWindowFocus set to false', () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// queryKeys.triggers
// ---------------------------------------------------------------------------
describe('queryKeys.triggers', () => {
  it('all returns ["triggers"]', () => {
    expect(queryKeys.triggers.all).toEqual(['triggers']);
  });

  it('list(projectId) returns ["triggers", "list", projectId]', () => {
    expect(queryKeys.triggers.list('proj-123')).toEqual([
      'triggers',
      'list',
      'proj-123',
    ]);
  });

  it('list(null) returns ["triggers", "list", null]', () => {
    expect(queryKeys.triggers.list(null)).toEqual(['triggers', 'list', null]);
  });

  it('userCount() returns ["triggers", "userCount"]', () => {
    expect(queryKeys.triggers.userCount()).toEqual(['triggers', 'userCount']);
  });

  it('detail(triggerId) returns ["triggers", "detail", triggerId]', () => {
    expect(queryKeys.triggers.detail(42)).toEqual(['triggers', 'detail', 42]);
  });

  it('configs(triggerType) returns ["triggers", "configs", triggerType]', () => {
    expect(queryKeys.triggers.configs('webhook')).toEqual([
      'triggers',
      'configs',
      'webhook',
    ]);
  });

  it('allConfigs() returns ["triggers", "configs"]', () => {
    expect(queryKeys.triggers.allConfigs()).toEqual(['triggers', 'configs']);
  });
});
