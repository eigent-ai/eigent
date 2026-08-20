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
import { usePageTabStore } from '@/store/pageTabStore';
import { FileText } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function extension(name: string): string {
  return name.includes('.') ? name.split('.').at(-1) || '' : '';
}

function fileInfoFromProjectedArtifact(artifact: ProjectedArtifact): FileInfo {
  return {
    name: artifact.name,
    type: extension(artifact.name),
    // A portable identity is not a local path capability. Cloud assets are
    // resolved lazily; local files stay display-only until a scoped workspace
    // resolver can enrich them.
    // TODO(CAMEL): resolve local Artifact identity against the owning
    // Space/Attempt workspace lease and return a trusted local file handle.
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
    localPathAvailable: artifact.localPathAvailable,
    assetRef: artifact.assetRef,
    isRemote: !artifact.localPathAvailable && Boolean(artifact.assetRef),
  };
}

function fileInfoFromChatArtifact(artifact: ChatArtifactNode): FileInfo {
  const name =
    artifact.name ||
    artifact.relativePath?.split('/').filter(Boolean).at(-1) ||
    artifact.path.split('/').filter(Boolean).at(-1) ||
    artifact.path;
  return {
    name,
    type: extension(name),
    path: '',
    relativePath: artifact.relativePath,
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

export function isRunFilePreviewable(file: FileInfo): boolean {
  return (
    file.localPathAvailable === false &&
    typeof file.assetRef?.chatFileId === 'number'
  );
}

export interface RunFilesProps {
  artifactNodes?: readonly ChatArtifactNode[];
  projectedArtifacts?: readonly ProjectedArtifact[];
}

export function useRunFileInfo({
  artifactNodes = [],
  projectedArtifacts = [],
}: RunFilesProps): FileInfo[] {
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
