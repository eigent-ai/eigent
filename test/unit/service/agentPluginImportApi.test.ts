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

import { fetchPost } from '@/api/http';
import {
  convertAgentPluginToWorkspaceBundleDraft,
  inspectAgentPluginSource,
} from '@/service/agentPluginImportApi';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', () => ({ fetchPost: vi.fn() }));

describe('Agent Plugins import API', () => {
  const reviewDigest = 'a'.repeat(64);

  beforeEach(() => vi.mocked(fetchPost).mockReset());

  it('sends a user-selected local source only to the local inspection API', async () => {
    vi.mocked(fetchPost).mockResolvedValue({ review_digest: reviewDigest });

    await inspectAgentPluginSource({
      sourcePath: '/selected/plugin',
      email: 'owner@example.com',
      userId: 'user-1',
    });

    expect(fetchPost).toHaveBeenCalledWith(
      '/workspace-bundles/agent-plugins:inspect',
      {
        source_path: '/selected/plugin',
        email: 'owner@example.com',
        user_id: 'user-1',
      }
    );
  });

  it('binds conversion to the reviewed digest and target Space without credential values', async () => {
    vi.mocked(fetchPost).mockResolvedValue({ status: 'draft' });

    await convertAgentPluginToWorkspaceBundleDraft({
      sourcePath: '/selected/plugin.zip',
      expectedReviewDigest: reviewDigest,
      targetSpaceId: 'space-1',
      expectedTargetDraftVersion: 7,
      clientRequestId: 'agent-plugin-import-1',
      updatedBy: 'user-1',
      email: 'owner@example.com',
      userId: 'user-1',
    });

    const [, body] = vi.mocked(fetchPost).mock.calls[0];
    expect(body).toEqual({
      source_path: '/selected/plugin.zip',
      expected_review_digest: reviewDigest,
      target_space_id: 'space-1',
      expected_target_draft_version: 7,
      client_request_id: 'agent-plugin-import-1',
      updated_by: 'user-1',
      email: 'owner@example.com',
      user_id: 'user-1',
    });
    expect(JSON.stringify(body)).not.toMatch(/secret|token|password|value/i);
  });
});
