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

import { buildProjectSessionPanelData } from '@/components/Session/SidePanel/sections/buildProjectSessionPanelData';
import { buildProjectSessionOverview } from '@/hooks/useProjectSessionOverview';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type {
  ProjectedArtifact,
  ProjectedArtifactManifest,
} from '@/lib/projector/types';
import { reconcileRunOutputFiles } from '@/lib/sessionOutputFiles';
import { ProjectEventStore } from '@/store/projectEventStore';
import { describe, expect, it } from 'vitest';

const manifest: ProjectedArtifactManifest = {
  runSequence: 20,
  createdAt: '2026-09-15T00:00:00Z',
  scanStatus: 'complete',
  truncated: false,
};
function node(
  path: string,
  sequence: number,
  extra: Partial<ChatArtifactNode> = {}
): ChatArtifactNode {
  return {
    id: `event-${sequence}`,
    eventId: `event-${sequence}`,
    projectId: 'project-1',
    runId: 'run-1',
    createdAt: null,
    runSequence: sequence,
    cloudCursor: null,
    eventType: 'artifact.created',
    legacyStep: null,
    kind: 'artifact',
    operation: 'created',
    path,
    relativePath: path,
    name: path.split('/').at(-1) || '',
    ...extra,
  };
}
function artifact(
  path: string,
  extra: Partial<ProjectedArtifact> = {}
): ProjectedArtifact {
  return {
    artifactId: `id:${path}`,
    runId: 'run-1',
    relativePath: path,
    name: path.split('/').at(-1)!,
    changeType: 'generated',
    size: 0,
    modifiedAt: 1,
    uploadPolicy: 'metadata_only',
    localPathAvailable: false,
    ...extra,
  };
}
const paths = Array.from({ length: 5 }, (_, i) => `notes${i + 1}.md`);
const recoveredWrites = [
  node(paths[0], 1),
  node(paths[1], 2),
  ...paths.map((path, i) => node(path, i + 3, { artifactId: `id:${path}` })),
];

describe('Session output reconciliation', () => {
  it('collapses seven recovered write records into five named outputs and retains canonical IDs', () => {
    const result = reconcileRunOutputFiles({
      artifactNodes: [...recoveredWrites, ...recoveredWrites],
    });
    expect(result.map((row) => row.file.relativePath)).toEqual(paths);
    expect(result.map((row) => row.file.artifactId)).toEqual(
      paths.map((path) => `id:${path}`)
    );
  });
  it('lets a complete empty manifest remove stale writes but accepts newer writes', () => {
    expect(
      reconcileRunOutputFiles({
        artifactNodes: recoveredWrites,
        projectedArtifacts: [],
        artifactManifest: manifest,
      })
    ).toEqual([]);
    const result = reconcileRunOutputFiles({
      artifactNodes: [...recoveredWrites, node('new.md', 21)],
      projectedArtifacts: [],
      artifactManifest: manifest,
    });
    expect(result.map((row) => row.file.name)).toEqual(['new.md']);
  });
  it.each([
    { scanStatus: 'partial', truncated: false },
    { scanStatus: 'unavailable', truncated: false },
    { scanStatus: 'complete', truncated: true },
  ])('retains successful writes during an incomplete scan: %j', (status) => {
    const result = reconcileRunOutputFiles({
      artifactNodes: recoveredWrites,
      projectedArtifacts: [artifact(paths[0])],
      artifactManifest: { ...manifest, ...status },
    });
    expect(result).toHaveLength(5);
    expect(result.find((row) => row.file.name === 'notes1.md')?.file.size).toBe(
      0
    );
  });
  it('uses a populated final manifest as the authority and preserves remote metadata', () => {
    const assetRef = { chatFileId: 7, bucket: 'assets', key: 'notes1.md' };
    const result = reconcileRunOutputFiles({
      artifactNodes: [...recoveredWrites, node('stale.md', 10)],
      projectedArtifacts: [artifact(paths[0], { assetRef })],
      artifactManifest: manifest,
    });
    expect(result).toHaveLength(1);
    expect(result[0].file).toMatchObject({
      size: 0,
      uploadPolicy: 'metadata_only',
      assetRef,
      isRemote: true,
    });
  });
  it('handles deletion, recreation, and later path-only updates without losing the ID', () => {
    const base = node('notes.md', 1, { artifactId: 'canonical' });
    expect(
      reconcileRunOutputFiles({
        artifactNodes: [base, node('notes.md', 2, { operation: 'deleted' })],
      })
    ).toEqual([]);
    const result = reconcileRunOutputFiles({
      artifactNodes: [
        base,
        node('notes.md', 2, { operation: 'deleted' }),
        node('notes.md', 3, { artifactId: 'new-id' }),
        node('notes.md', 4, { operation: 'updated' }),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].file.artifactId).toBe('new-id');
  });
  it('keeps different directories and Runs separate', () => {
    expect(
      reconcileRunOutputFiles({
        artifactNodes: [
          node('a/report.md', 1),
          node('b/report.md', 2),
          node('a/report.md', 1, { runId: 'run-2' }),
        ],
      })
    ).toHaveLength(3);
  });
  it('drops blank or unidentifiable records but retains named unavailable canonical outputs', () => {
    const result = reconcileRunOutputFiles({
      artifactNodes: [
        node('', 1, { artifactId: 'blank' }),
        node('', 2, { name: 'name-only.md' }),
        node('', 3, { name: 'unavailable.md', artifactId: 'remote' }),
      ],
    });
    expect(result.map((row) => row.file.name)).toEqual(['unavailable.md']);
    expect(result[0].file.relativePath).toBeUndefined();
    expect(result[0].file.path).toBe('');
  });
  it('hides runtime directories across event and manifest sources while keeping authored logs and empty files', () => {
    const result = reconcileRunOutputFiles({
      artifactNodes: [
        node('terminal_logs/blocking_commands.log', 1),
        node('camel_logs/debug.log', 2),
        node('outputs/terminal_logs/old.log', 3),
        node('reports/authored.log', 4),
      ],
      projectedArtifacts: [
        artifact('terminal_logs/blocking_commands.log'),
        artifact('outputs/empty.md'),
        artifact('terminal_logs_report.log'),
      ],
      artifactManifest: { ...manifest, scanStatus: 'partial' },
    });
    expect(result.map((row) => row.file.name)).toEqual([
      'authored.log',
      'empty.md',
      'terminal_logs_report.log',
    ]);
  });
});

it('keeps Chat and Summary aligned through recorded writes and synthetic snapshot recovery', () => {
  // The first two payload shapes come from the reporter's journal search
  // receipts (cursors 77 and 102). IDs/timestamps are sanitized; envelopes,
  // later artifact events, and manifests are synthetic because the full
  // original event journal was not included in the report.
  const names = Array.from({ length: 5 }, (_, i) => `notes-${i + 1}.md`);
  const event = (sequence: number, type: string, payload: object) => ({
    event_id: `event-${sequence}`,
    project_id: 'project-1',
    run_id: 'run-1',
    run_sequence: sequence,
    run_version: sequence,
    cloud_cursor: sequence,
    event_type: type,
    payload,
    legacy_step: null,
    created_at: '2026-09-15T00:00:00Z',
  });
  const recordedWrites = names.slice(0, 2).map((name, index) =>
    event(index + 1, 'file.written', {
      display_schema_version: 1,
      display_title: `Wrote ${name}`,
      name,
      operation: 'written',
      process_task_id: 'run-1',
      relative_path: name,
      step_id: `step-${index + 1}`,
      semantic_schema_version: 1,
      semantic: {
        completeness: { missing_fields: [], state: 'complete' },
        correlation: { step_id: `step-${index + 1}`, task_id: 'run-1' },
        kind: 'file_change',
        lifecycle: { phase: 'completed', status: 'completed' },
        provenance: { source: 'legacy.write_file' },
        subject: { id: name, type: 'file' },
      },
    })
  );
  const recovered = [
    ...recordedWrites,
    ...names.map((name, index) =>
      event(index + 3, 'artifact.created', {
        name,
        relative_path: name,
        artifact_id: `id-${name}`,
      })
    ),
  ];
  const store = new ProjectEventStore('project-1');
  function restore(events: unknown[], artifacts?: object[]) {
    store.replaceSnapshot({
      project_id: 'project-1',
      current_cursor: 10,
      recent_events: events,
      artifact_events:
        artifacts === undefined
          ? []
          : [
              event(10, 'artifact.manifest.finalized', {
                artifacts,
                scan_status: 'complete',
                truncated: false,
              }),
            ],
    });
    const snapshot = store.getSnapshot();
    const chatFiles = reconcileRunOutputFiles({
      artifactNodes: snapshot.chat.nodes.filter(
        (n): n is ChatArtifactNode => n.kind === 'artifact'
      ),
      projectedArtifacts: snapshot.view.artifactsByRun['run-1'],
      artifactManifest: snapshot.view.artifactManifestsByRun?.['run-1'],
    });
    const panel = buildProjectSessionPanelData(
      buildProjectSessionOverview(snapshot).runs,
      []
    );
    expect(panel.files.map((item) => item.file.relativePath).sort()).toEqual(
      chatFiles.map((item) => item.file.relativePath).sort()
    );
    return chatFiles;
  }
  expect(restore(recordedWrites)).toHaveLength(2);
  expect(restore([...recovered, ...recovered])).toHaveLength(5);
  const final = names.map((name) => ({
    artifact_id: `id-${name}`,
    filename: name,
    relativePath: name,
    changeType: 'generated',
    localPathAvailable: true,
  }));
  expect(restore(recovered, final)).toHaveLength(5);
  expect(restore(recovered, [])).toHaveLength(0);
  expect(restore(recovered, [])).toHaveLength(0);
  store.dispose();
});
