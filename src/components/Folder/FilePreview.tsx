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

import { Button } from '@/components/ui/button';
import { useHost } from '@/host';
import { loadFilePreview } from '@/lib/filePreviewLoader';
import { resolveArtifactAssetFile } from '@/service/artifactAssetApi';
import { FileText, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { downloadFromUrl, downloadOpenedFile, FileViewerPanel } from './index';

export interface FilePreviewProps {
  /** File to preview, or null to show the empty "select a file" placeholder. */
  file: FileInfo | null;
  /** Outer surface background class (project page uses default-default). */
  surfaceClassName?: string;
  /** Remove the standalone rounded/margin frame when hosted in a tab shell. */
  embedded?: boolean;
  /** Sibling project files, used by the HTML renderer to resolve local assets. */
  projectFiles?: FileInfo[];
  /** Close the preview column. */
  onClose?: () => void;
  /**
   * Navigate to the Files tab for the given file (or null to just open the file
   * list). Wired from the breadcrumb "Files" root and the empty state.
   */
  onJumpToFiles?: (file: FileInfo | null) => void;
}

/**
 * Inline file preview shown beside the chat content on the project page.
 * Owns its own content-loading state and reuses {@link FileViewerPanel} so it
 * renders markdown/PDF/docs/HTML/media identically to the Files tab.
 */
export function FilePreview({
  file,
  surfaceClassName = 'bg-ds-neutral-default-default',
  embedded = false,
  projectFiles = [],
  onClose,
  onJumpToFiles,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;

  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [isShowSourceCode, setIsShowSourceCode] = useState(false);
  const previewRequestRef = useRef<AbortController | null>(null);

  // Mirror of the Files loader (selectedFileChange): read content via the
  // electron host (or remote fetch) and stash it on the file for the viewer.
  const loadFileContent = useCallback(
    (target: FileInfo, showSource?: boolean) => {
      // Folders / archives are not previewable inline.
      if (target.isFolder || target.type === 'zip') {
        previewRequestRef.current?.abort();
        setSelectedFile(null);
        setLoading(false);
        return;
      }

      previewRequestRef.current?.abort();
      const controller = new AbortController();
      previewRequestRef.current = controller;
      setSelectedFile(target);
      setLoading(true);
      void resolveArtifactAssetFile(target)
        .then((resolved) =>
          loadFilePreview(resolved, {
            ipcRenderer,
            showSource,
            signal: controller.signal,
          })
        )
        .then((loadedFile) => {
          if (!controller.signal.aborted) setSelectedFile(loadedFile);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            console.error('Failed to load file preview:', error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [ipcRenderer]
  );

  useEffect(
    () => () => {
      previewRequestRef.current?.abort();
    },
    []
  );

  // Reload whenever the previewed file changes. Reset the source-code toggle so
  // each new file opens in its rich view.
  useEffect(() => {
    setIsShowSourceCode(false);
    if (!file) {
      setSelectedFile(null);
      setLoading(false);
      return;
    }
    loadFileContent(file, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    file?.path,
    file?.relativePath,
    file?.artifactId,
    file?.isRemote,
    file?.assetRef?.chatFileId,
    loadFileContent,
  ]);

  // Breadcrumb is intentionally shallow: "Files > filename". The root opens
  // the Files tab for this file.
  const filesLabel = t('layout.files-tab', { defaultValue: 'Files' });
  const breadcrumbSegments = useMemo(
    () => (selectedFile ? [filesLabel, selectedFile.name] : []),
    [selectedFile, filesLabel]
  );

  const handleBreadcrumbSegmentClick = useCallback(
    (index: number) => {
      if (index === 0) {
        onJumpToFiles?.(selectedFile);
      }
    },
    [onJumpToFiles, selectedFile]
  );

  const handleToggleSourceCode = useCallback(() => {
    if (!selectedFile) return;
    setIsShowSourceCode((prev) => !prev);
  }, [selectedFile]);

  const handleRevealFile = useCallback(async () => {
    if (!selectedFile) return;
    if (selectedFile.isRemote) {
      if (selectedFile.preview?.kind === 'blocked') {
        window.open(selectedFile.path, '_blank', 'noopener,noreferrer');
        return;
      }
      void downloadFromUrl(selectedFile.path, selectedFile.name);
      return;
    }
    try {
      const result = await ipcRenderer?.invoke(
        'reveal-in-folder',
        selectedFile.path
      );
      if (!result?.success) {
        toast.error(result?.error || t('chat.failed-to-open-folder'));
      }
    } catch (error) {
      console.error('Failed to reveal file:', error);
      toast.error(t('chat.failed-to-open-folder'));
    }
  }, [selectedFile, ipcRenderer, t]);

  const handleDownloadFile = useCallback(() => {
    if (!selectedFile || selectedFile.isFolder) return;
    if (selectedFile.preview?.kind === 'blocked') {
      if (selectedFile.isRemote) {
        window.open(selectedFile.path, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    void downloadOpenedFile(selectedFile);
  }, [selectedFile]);

  const handleOpenExternalFile = useCallback(() => {
    if (!selectedFile) return;
    if (selectedFile.isRemote) {
      window.open(selectedFile.path, '_blank', 'noopener,noreferrer');
      return;
    }
    void ipcRenderer?.invoke('open-local-file', selectedFile.path);
  }, [selectedFile, ipcRenderer]);

  return (
    <FileViewerPanel
      selectedFile={selectedFile}
      loading={loading}
      isShowSourceCode={isShowSourceCode}
      breadcrumbSegments={breadcrumbSegments}
      onBreadcrumbSegmentClick={
        onJumpToFiles ? handleBreadcrumbSegmentClick : undefined
      }
      projectFiles={projectFiles}
      surfaceClassName={surfaceClassName}
      embedded={embedded}
      onRevealFile={handleRevealFile}
      onOpenExternalFile={handleOpenExternalFile}
      onDownloadFile={handleDownloadFile}
      onToggleSourceCode={handleToggleSourceCode}
      emptyState={
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-ds-ink-muted-default">
          <FileText className="h-12 w-12 text-ds-ink-muted-default" />
          <p className="text-sm">
            {t('chat.no-file-selected', {
              defaultValue: 'No file selected.',
            })}
          </p>
          {onJumpToFiles ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onJumpToFiles(null)}
            >
              {t('layout.jump-to-files', {
                defaultValue: 'See all files in your workspace',
              })}
            </Button>
          ) : null}
        </div>
      }
      headerActionsExtra={
        onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('common.close', { defaultValue: 'Close' })}
            onClick={onClose}
          >
            <X className="h-4 w-4 text-ds-ink-muted-default" />
          </Button>
        ) : undefined
      }
    />
  );
}

export default FilePreview;
