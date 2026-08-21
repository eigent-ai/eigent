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

import { ArtifactChangeList } from '@/components/ChatBox/MessageItem/ArtifactChangeList';
import type { ChatArtifactNode } from '@/lib/projector/chat';
import type { ProjectedArtifact } from '@/lib/projector/types';
import { cn } from '@/lib/utils';
import {
  normalizeWorkspaceRelativePath,
  resolveWorkspaceFilePath,
} from '@/lib/workspaceRelativePath';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function extension(name: string): string {
  return name.includes('.') ? name.split('.').at(-1) || '' : '';
}

export function normalizeRunReviewPath(
  value: string | undefined
): string | null {
  return normalizeWorkspaceRelativePath(value);
}

function fileInfoFromProjectedArtifact(artifact: ProjectedArtifact): FileInfo {
  const localPathAvailable = artifact.localPathAvailable;
  return {
    name: artifact.name,
    type: extension(artifact.name),
    path: '',
    relativePath: artifact.relativePath,
    artifactId: artifact.artifactId,
    artifactChange: artifact.changeType,
    size: artifact.size ?? undefined,
    modifiedAt: artifact.modifiedAt ?? undefined,
    uploadPolicy:
      artifact.uploadPolicy === 'agent_generated' ||
      artifact.uploadPolicy === 'metadata_only'
        ? artifact.uploadPolicy
        : undefined,
    localPathAvailable,
    assetRef: artifact.assetRef,
    isRemote: !localPathAvailable && Boolean(artifact.assetRef),
  };
}

function fileInfoFromChatArtifact(artifact: ChatArtifactNode): FileInfo {
  const relativePath =
    normalizeRunReviewPath(artifact.relativePath) ??
    normalizeRunReviewPath(artifact.path) ??
    undefined;
  const name =
    artifact.name ||
    relativePath?.split('/').filter(Boolean).at(-1) ||
    artifact.path.split('/').filter(Boolean).at(-1) ||
    artifact.path;
  return {
    name,
    type: extension(name),
    path: '',
    relativePath,
    artifactId: artifact.artifactId,
    artifactChange:
      artifact.operation === 'created'
        ? 'generated'
        : artifact.operation === 'updated'
          ? 'changed'
          : undefined,
    mimeType: artifact.mimeType,
  };
}

function uniqueFiles(files: readonly FileInfo[]): FileInfo[] {
  const byIdentity = new Map<string, FileInfo>();
  for (const file of files) {
    const key = file.artifactId || file.relativePath || file.path || file.name;
    byIdentity.set(key, file);
  }
  return [...byIdentity.values()];
}

export function runFileReviewPath(file: FileInfo): string | null {
  return normalizeRunReviewPath(file.relativePath);
}

export function resolveRunFilePreview(
  file: FileInfo,
  workspaceRoot: string | null | undefined
): FileInfo | null {
  // A projected Artifact may retain its Cloud reference even after the local
  // Project workspace has been restored. Prefer that workspace copy so file
  // previews keep using Electron's bounded local loader (including the rich
  // HTML renderer) instead of a short-lived, CORS-sensitive signed URL.
  const localPath = resolveWorkspaceFilePath(workspaceRoot, file.relativePath);
  if (localPath) {
    return {
      ...file,
      path: localPath,
      localPathAvailable: true,
      isRemote: false,
    };
  }

  const existingPath = file.path?.trim();
  if (existingPath && !file.isRemote) return file;
  if (file.isRemote && (file.assetRef || /^https?:\/\//i.test(existingPath))) {
    return file;
  }
  return null;
}

export interface RunFileSources {
  artifactNodes?: readonly ChatArtifactNode[];
  projectedArtifacts?: readonly ProjectedArtifact[];
}

export interface RunFilesProps extends RunFileSources {
  runId: string;
}

export function useRunFileInfo({
  artifactNodes = [],
  projectedArtifacts = [],
}: RunFileSources): FileInfo[] {
  return useMemo(
    () =>
      uniqueFiles(
        projectedArtifacts.length > 0
          ? projectedArtifacts.map(fileInfoFromProjectedArtifact)
          : artifactNodes
              .filter((artifact) => artifact.operation !== 'deleted')
              .map(fileInfoFromChatArtifact)
      ),
    [artifactNodes, projectedArtifacts]
  );
}

export function RunFilesGroup(props: RunFilesProps) {
  const files = useRunFileInfo(props);
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const workspaceRoot = useSpaceStore((state) => {
    const spaceId = projectId ? state.getProjectMeta(projectId)?.spaceId : null;
    return spaceId ? state.spaces[spaceId]?.rootPath : null;
  });
  const openFilePreview = usePageTabStore((state) => state.openFilePreview);
  const openReviewPreview = usePageTabStore((state) => state.openReviewPreview);

  return (
    <ArtifactChangeList
      files={files}
      onViewChanges={() => openReviewPreview({ runId: props.runId })}
      onOpen={(file) => {
        const preview = resolveRunFilePreview(file, workspaceRoot);
        if (preview) openFilePreview(preview);
      }}
      canOpenFile={(file) =>
        resolveRunFilePreview(file, workspaceRoot) !== null
      }
    />
  );
}

export function FilesChangedSummaryRow({
  embedded = false,
  ...props
}: RunFileSources & { embedded?: boolean }) {
  const { t } = useTranslation();
  const files = useRunFileInfo(props);

  return (
    <div
      className={cn(
        'flex min-h-10 w-full items-center gap-2 px-3 py-2',
        embedded
          ? 'border-x-0 border-b-0 border-t border-solid border-ds-border-neutral-subtle-default bg-transparent'
          : 'rounded-xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default'
      )}
      data-files-changed-summary
    >
      <FileText
        aria-hidden
        className="size-4 shrink-0 text-ds-icon-neutral-subtle-default"
      />
      <span className="min-w-0 flex-1 text-body-sm font-normal text-ds-text-neutral-default-default">
        {t('chat.files-changed')}
      </span>
      <span className="shrink-0 text-label-sm font-medium tabular-nums text-ds-text-success-default-default">
        {files.length}
      </span>
    </div>
  );
}
