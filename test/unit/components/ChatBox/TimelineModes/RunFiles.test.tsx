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
  isRunFilePreviewable,
  RunFilesGroup,
  useRunFileInfo,
} from '@/components/ChatBox/TimelineModes/RunFiles';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type { ProjectedArtifact } from '@/lib/projector/types';
import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const projectedArtifact: ProjectedArtifact = {
  artifactId: 'artifact-1',
  runId: 'run-1',
  name: 'report.csv',
  relativePath: 'reports/report.csv',
  changeType: 'generated',
  size: 10,
  modifiedAt: 1,
  uploadPolicy: 'agent_generated',
  localPathAvailable: true,
};

const realtimeArtifact: ChatArtifactNode = {
  id: 'artifact-event-1',
  eventId: 'artifact-event-1',
  projectId: 'project-1',
  runId: 'run-1',
  createdAt: '2026-08-20T00:00:00Z',
  runSequence: 1,
  cloudCursor: null,
  eventType: 'artifact.created',
  legacyStep: null,
  kind: 'artifact',
  operation: 'created',
  path: 'reports/report.csv',
  relativePath: 'reports/report.csv',
  name: 'report.csv',
};

describe('RunFiles capability boundary', () => {
  it('does not turn portable local or realtime identity into a file path', () => {
    const projected = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [projectedArtifact] })
    );
    const realtime = renderHook(() =>
      useRunFileInfo({ artifactNodes: [realtimeArtifact] })
    );

    expect(projected.result.current[0]).toMatchObject({
      path: '',
      relativePath: 'reports/report.csv',
      localPathAvailable: true,
    });
    expect(realtime.result.current[0]).toMatchObject({
      path: '',
      relativePath: 'reports/report.csv',
    });
    expect(isRunFilePreviewable(projected.result.current[0]!)).toBe(false);
    expect(isRunFilePreviewable(realtime.result.current[0]!)).toBe(false);
  });

  it('renders unresolved local Artifacts as display-only rows', () => {
    render(<RunFilesGroup projectedArtifacts={[projectedArtifact]} />);

    const row = screen.getByTitle('reports/report.csv');
    expect(row).toHaveAttribute('data-artifact-preview', 'unavailable');
    expect(row.tagName).toBe('DIV');
  });

  it('allows only a resolvable Cloud asset into the preview pipeline', () => {
    const cloud = {
      ...projectedArtifact,
      localPathAvailable: false,
      assetRef: {
        chatFileId: 73,
        key: 'user/run/files/report.csv',
      },
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({
        projectedArtifacts: [cloud],
        workspaceRoot: '/Users/test/workspace',
      })
    );

    expect(result.current[0]).toMatchObject({
      path: '',
      localPathAvailable: false,
      isRemote: true,
      assetRef: cloud.assetRef,
    });
    expect(isRunFilePreviewable(result.current[0]!)).toBe(true);
  });

  it('resolves local workspace files so every changed file can open in preview', () => {
    const changed = {
      ...projectedArtifact,
      artifactId: 'artifact-2',
      name: 'notes.md',
      relativePath: 'notes.md',
      changeType: 'changed',
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({
        projectedArtifacts: [projectedArtifact, changed],
        workspaceRoot: '/Users/test/workspace',
      })
    );

    expect(result.current.map((file) => file.path)).toEqual([
      '/Users/test/workspace/reports/report.csv',
      '/Users/test/workspace/notes.md',
    ]);
    expect(result.current.every((file) => isRunFilePreviewable(file))).toBe(
      true
    );

    render(
      <RunFilesGroup
        projectedArtifacts={[projectedArtifact, changed]}
        workspaceRoot="/Users/test/workspace"
      />
    );

    expect(screen.getByTitle('reports/report.csv').tagName).toBe('BUTTON');
    expect(screen.getByTitle('notes.md').tagName).toBe('BUTTON');
  });
});
