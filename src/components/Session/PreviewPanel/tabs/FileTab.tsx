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

import { FilePreview } from '@/components/Folder/FilePreview';
import { TeachCommentPopover } from '@/components/TeachMode/TeachCommentPopover';
import { getWorkspaceRelativeFilePath } from '@/lib/workspaceRelativePath';
import { usePageTabStore, type SessionFileTab } from '@/store/pageTabStore';

export interface FileTabProps {
  tab: SessionFileTab;
  onJumpToFiles?: (file: FileInfo | null) => void;
}

/** File preview surface for one file tab. */
export function FileTab({ tab, onJumpToFiles }: FileTabProps) {
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const detail = tab.file ? getWorkspaceRelativeFilePath(tab.file) : '';
  return (
    <div
      className="h-full min-h-0"
      data-teach-feedback-source={tab.file ? `file:${detail}` : undefined}
      data-teach-annotation-label={tab.file?.name}
      data-teach-annotation-detail={detail || undefined}
    >
      <FilePreview
        file={tab.file}
        embedded
        surfaceClassName="bg-ds-neutral-default-default"
        onJumpToFiles={onJumpToFiles}
        headerActionsExtra={
          tab.file ? (
            <TeachCommentPopover
              projectId={projectId}
              sourceType="file"
              sourceId={`file:${detail}`}
              contextLabel={tab.file.name || detail}
              contextDetail={detail}
              triggerVariant="icon"
            />
          ) : undefined
        }
      />
    </div>
  );
}

export default FileTab;
