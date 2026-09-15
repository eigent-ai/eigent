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

import { isVisibleAgentFile } from '@/lib/agentFileFilters';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type {
  ProjectedArtifact,
  ProjectedArtifactManifest,
} from '@/lib/projector/types';
import { normalizeWorkspaceRelativePath } from '@/lib/workspaceRelativePath';

export interface RunOutputSources {
  artifactNodes?: readonly ChatArtifactNode[];
  /** Undefined means absent; an empty array can be an authoritative manifest. */
  projectedArtifacts?: readonly ProjectedArtifact[];
  artifactManifest?: ProjectedArtifactManifest;
}

export interface RunOutputFile {
  runId: string;
  file: FileInfo;
  createdAt?: string;
  updatedAt?: string;
}

type FileEvent = RunOutputFile & {
  sequence: number;
  eventId: string;
  deleted?: boolean;
};

function fileName(name: string | undefined, relativePath?: string): string {
  return relativePath?.split('/').at(-1) || name?.trim() || '';
}

/** Portable presentation data only. Local paths are supplied by the resolver. */
function fromNode(node: ChatArtifactNode): FileEvent {
  const relativePath =
    normalizeWorkspaceRelativePath(node.relativePath) ??
    // Older nodes sometimes carry a portable path in `path`. A display-only
    // basename from the adapter must never turn into an openable local path.
    (node.path.includes('/')
      ? normalizeWorkspaceRelativePath(node.path)
      : null) ??
    undefined;
  const name = fileName(node.name, relativePath);
  return {
    runId: node.runId,
    sequence: node.runSequence,
    eventId: node.eventId,
    createdAt: node.createdAt ?? undefined,
    updatedAt: node.createdAt ?? undefined,
    deleted: node.operation === 'deleted',
    file: {
      name,
      type: name.includes('.') ? name.split('.').at(-1) || '' : '',
      path: '',
      relativePath,
      artifactId: node.artifactId?.trim() || undefined,
      artifactChange:
        node.operation === 'created'
          ? 'generated'
          : node.operation === 'updated'
            ? 'changed'
            : undefined,
      mimeType: node.mimeType,
    },
  };
}

function fromArtifact(
  artifact: ProjectedArtifact,
  manifest?: ProjectedArtifactManifest
): FileEvent {
  const relativePath =
    normalizeWorkspaceRelativePath(artifact.relativePath) ?? undefined;
  const name = fileName(artifact.name, relativePath);
  return {
    runId: artifact.runId,
    sequence: manifest?.runSequence ?? Number.MAX_SAFE_INTEGER,
    eventId: artifact.artifactId,
    createdAt: manifest?.createdAt,
    updatedAt: manifest?.createdAt,
    file: {
      name,
      type: name.includes('.') ? name.split('.').at(-1) || '' : '',
      path: '',
      relativePath,
      artifactId: artifact.artifactId?.trim() || undefined,
      artifactChange: artifact.changeType,
      size: artifact.size ?? undefined,
      modifiedAt: artifact.modifiedAt ?? undefined,
      uploadPolicy:
        artifact.uploadPolicy === 'agent_generated' ||
        artifact.uploadPolicy === 'metadata_only'
          ? artifact.uploadPolicy
          : undefined,
      localPathAvailable: artifact.localPathAvailable,
      assetRef: artifact.assetRef,
      isRemote: !artifact.localPathAvailable && Boolean(artifact.assetRef),
    },
  };
}

/** Reconcile one row per Run/path across writes, recovery, and finalization. */
export function reconcileRunOutputFiles({
  artifactNodes = [],
  projectedArtifacts,
  artifactManifest,
}: RunOutputSources): RunOutputFile[] {
  const completeManifest =
    projectedArtifacts !== undefined &&
    (!artifactManifest ||
      (artifactManifest.scanStatus === 'complete' &&
        !artifactManifest.truncated));
  const events = artifactNodes
    .filter(
      (node) =>
        !completeManifest ||
        (artifactManifest && node.runSequence > artifactManifest.runSequence)
    )
    .map(fromNode);
  events.push(
    ...(projectedArtifacts ?? []).map((artifact) =>
      fromArtifact(artifact, artifactManifest)
    )
  );
  events.sort(
    (a, b) => a.sequence - b.sequence || a.eventId.localeCompare(b.eventId)
  );

  const files = new Map<string, RunOutputFile>();
  const keysById = new Map<string, string>();
  for (const event of events) {
    const { file, runId } = event;
    const id = file.artifactId ? `${runId}\0id:${file.artifactId}` : null;
    const pathKey = file.relativePath
      ? `${runId}\0path:${file.relativePath}`
      : null;
    const previousIdKey = id ? keysById.get(id) : undefined;
    const key = pathKey || previousIdKey || id;
    if (!key) continue;
    if (event.deleted) {
      files.delete(key);
      if (previousIdKey) files.delete(previousIdKey);
      continue;
    }
    if (!file.name || !isVisibleAgentFile(file)) continue;
    const existing =
      files.get(key) ?? (previousIdKey ? files.get(previousIdKey) : undefined);
    if (previousIdKey && previousIdKey !== key) files.delete(previousIdKey);
    const merged = {
      ...existing?.file,
      ...Object.fromEntries(
        Object.entries(file).filter(([, value]) => value !== undefined)
      ),
    } as FileInfo;
    // A replayed path-only write enriches the same row, retaining its ID.
    if (id) keysById.set(id, key);
    files.set(key, {
      runId,
      file: merged,
      createdAt: existing?.createdAt ?? event.createdAt,
      updatedAt: event.updatedAt ?? existing?.updatedAt,
    });
  }
  return [...files.values()];
}
