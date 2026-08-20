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
import { resolveWorkspaceFilePath } from '@/lib/workspaceRelativePath';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function extension(name: string): string {
  return name.includes('.') ? name.split('.').at(-1) || '' : '';
}

function fileInfoFromProjectedArtifact(
  artifact: ProjectedArtifact,
  workspaceRoot?: string | null
): FileInfo {
  const localPathAvailable = artifact.localPathAvailable;
  const resolvedPath = localPathAvailable
    ? resolveWorkspaceFilePath(workspaceRoot, artifact.relativePath)
    : '';
  return {
    name: artifact.name,
    type: extension(artifact.name),
    path: resolvedPath,
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

function fileInfoFromChatArtifact(
  artifact: ChatArtifactNode,
  workspaceRoot?: string | null
): FileInfo {
  const name =
    artifact.name ||
    artifact.relativePath?.split('/').filter(Boolean).at(-1) ||
    artifact.path.split('/').filter(Boolean).at(-1) ||
    artifact.path;
  const resolvedPath = resolveWorkspaceFilePath(
    workspaceRoot,
    artifact.relativePath || artifact.path
  );
  return {
    name,
    type: extension(name),
    path: resolvedPath,
    relativePath: artifact.relativePath,
    artifactId: artifact.artifactId,
    artifactChange:
      artifact.operation === 'created'
        ? 'generated'
        : artifact.operation === 'updated'
          ? 'changed'
          : undefined,
    mimeType: artifact.mimeType,
    localPathAvailable: Boolean(resolvedPath),
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

export function isRunFilePreviewable(file: FileInfo): boolean {
  if (typeof file.assetRef?.chatFileId === 'number') return true;
  return Boolean(file.path?.trim());
}

export interface RunFilesProps {
  artifactNodes?: readonly ChatArtifactNode[];
  projectedArtifacts?: readonly ProjectedArtifact[];
  workspaceRoot?: string | null;
}

export function useRunFileInfo({
  artifactNodes = [],
  projectedArtifacts = [],
  workspaceRoot = null,
}: RunFilesProps): FileInfo[] {
  return useMemo(
    () =>
      uniqueFiles(
        projectedArtifacts.length > 0
          ? projectedArtifacts.map((artifact) =>
              fileInfoFromProjectedArtifact(artifact, workspaceRoot)
            )
          : artifactNodes
              .filter((artifact) => artifact.operation !== 'deleted')
              .map((artifact) =>
                fileInfoFromChatArtifact(artifact, workspaceRoot)
              )
      ),
    [artifactNodes, projectedArtifacts, workspaceRoot]
  );
}

export function RunFilesGroup(props: RunFilesProps) {
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const spaceRootPath = useSpaceStore((s) =>
    activeSpaceId ? s.spaces[activeSpaceId]?.rootPath : undefined
  );
  const files = useRunFileInfo({
    ...props,
    workspaceRoot: props.workspaceRoot ?? spaceRootPath ?? null,
  });
  const openFilePreview = usePageTabStore((state) => state.openFilePreview);

  return (
    <ArtifactChangeList
      files={files}
      onOpen={openFilePreview}
      canOpenFile={isRunFilePreviewable}
    />
  );
}

export function FilesChangedSummaryRow({
  embedded = false,
  ...props
}: RunFilesProps & { embedded?: boolean }) {
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
