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
  ProjectEventRuntimeProvider,
  useProjectEventRuntime,
} from '@/hooks/useProjectEventRuntime';
import { resetProjectEventStoresForTests } from '@/store/projectEventStore';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hydration: vi.fn(() => ({
    status: 'ready' as const,
    errorCode: null,
    eventsTruncated: false,
  })),
  streams: vi.fn(),
}));

vi.mock('@/hooks/useProjectEventStoreHydration', () => ({
  useProjectEventStoreHydration: mocks.hydration,
}));

vi.mock('@/hooks/useProjectRunEventStreams', () => ({
  useProjectRunEventStreams: mocks.streams,
}));

function Consumer() {
  const runtime = useProjectEventRuntime();
  return (
    <div>
      {runtime.projectId}:{runtime.snapshot?.revision ?? 'none'}:
      {runtime.hydration.status}
    </div>
  );
}

describe('ProjectEventRuntimeProvider', () => {
  afterEach(() => {
    resetProjectEventStoresForTests();
    vi.clearAllMocks();
  });

  it('owns one hydration and live-stream subscription for its Session', () => {
    render(
      <ProjectEventRuntimeProvider projectId="project-1">
        <Consumer />
      </ProjectEventRuntimeProvider>
    );

    expect(screen.getByText('project-1:0:ready')).toBeInTheDocument();
    expect(mocks.hydration).toHaveBeenCalledTimes(1);
    expect(mocks.hydration).toHaveBeenCalledWith({
      projectId: 'project-1',
      enabled: true,
    });
    expect(mocks.streams).toHaveBeenCalledTimes(1);
    expect(mocks.streams).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        enabled: true,
        snapshot: expect.objectContaining({ revision: 0 }),
      })
    );
  });

  it('detaches the previous Project snapshot when the Session has no scope', () => {
    const { rerender } = render(
      <ProjectEventRuntimeProvider projectId="project-previous">
        <Consumer />
      </ProjectEventRuntimeProvider>
    );

    expect(screen.getByText('project-previous:0:ready')).toBeInTheDocument();

    rerender(
      <ProjectEventRuntimeProvider projectId={null}>
        <Consumer />
      </ProjectEventRuntimeProvider>
    );

    expect(screen.getByText(':none:ready')).toBeInTheDocument();
    expect(mocks.hydration).toHaveBeenLastCalledWith({
      projectId: null,
      enabled: false,
    });
    expect(mocks.streams).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: null,
        enabled: false,
        snapshot: null,
      })
    );
  });

  it('rebinds hydration and streams when the active Project changes', () => {
    const { rerender } = render(
      <ProjectEventRuntimeProvider projectId="project-1">
        <Consumer />
      </ProjectEventRuntimeProvider>
    );

    rerender(
      <ProjectEventRuntimeProvider projectId="project-2">
        <Consumer />
      </ProjectEventRuntimeProvider>
    );

    expect(screen.getByText('project-2:0:ready')).toBeInTheDocument();
    expect(mocks.hydration).toHaveBeenLastCalledWith({
      projectId: 'project-2',
      enabled: true,
    });
    expect(mocks.streams).toHaveBeenLastCalledWith(
      expect.objectContaining({
        projectId: 'project-2',
        enabled: true,
        snapshot: expect.objectContaining({ revision: 0 }),
      })
    );
  });
});
