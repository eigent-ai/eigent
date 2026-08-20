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
  runFileReviewPath,
  RunFilesGroup,
  useRunFileInfo,
} from '@/components/ChatBox/TimelineModes/RunFiles';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type { ProjectedArtifact } from '@/lib/projector/types';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

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
  beforeEach(() => {
    usePageTabStore.setState({
      sessionPreviewProjectId: 'project-1',
      sessionPreviewByProject: {},
    });
  });

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
    expect(runFileReviewPath(projected.result.current[0]!)).toBe(
      'reports/report.csv'
    );
    expect(runFileReviewPath(realtime.result.current[0]!)).toBe(
      'reports/report.csv'
    );
  });

  it('opens an unresolved local Artifact in its Run-scoped Git review', () => {
    render(
      <RunFilesGroup projectedArtifacts={[projectedArtifact]} runId="run-1" />
    );

    const row = screen.getByTitle('reports/report.csv');
    expect(row).toHaveAttribute('data-artifact-preview', 'available');
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);

    const preview = getSessionPreviewSlice(usePageTabStore.getState());
    expect(preview.open).toBe(true);
    expect(preview.tabs).toHaveLength(1);
    expect(preview.tabs[0]).toMatchObject({
      type: 'review',
      title: 'Run review',
      reviewTarget: {
        scope: 'run',
        runId: 'run-1',
        focusPath: 'reports/report.csv',
      },
    });
  });

  it('uses the durable relative path for Cloud assets too', () => {
    const cloud = {
      ...projectedArtifact,
      localPathAvailable: false,
      assetRef: {
        chatFileId: 73,
        key: 'user/run/files/report.csv',
      },
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [cloud] })
    );

    expect(result.current[0]?.path).toBe('');
    expect(runFileReviewPath(result.current[0]!)).toBe('reports/report.csv');
  });

  it('rejects escaping paths before they reach the Run review API', () => {
    const unsafe = {
      ...projectedArtifact,
      relativePath: '../outside.txt',
    } satisfies ProjectedArtifact;
    const { result } = renderHook(() =>
      useRunFileInfo({ projectedArtifacts: [unsafe] })
    );

    expect(runFileReviewPath(result.current[0]!)).toBeNull();
  });
});
