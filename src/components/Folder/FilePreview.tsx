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
import { FileText, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  downloadFromUrl,
  downloadOpenedFile,
  fetchRemoteFileAsDataUrl,
  FileViewerPanel,
  isAudioFile,
  isImageFile,
  isVideoFile,
} from './index';

export interface FilePreviewProps {
  /** File to preview, or null to show the empty "select a file" placeholder. */
  file: FileInfo | null;
  /** Outer surface background class (project page uses default-default). */
  surfaceClassName?: string;
  /** Sibling project files, used by the HTML renderer to resolve local assets. */
  projectFiles?: FileInfo[];
  /** Close the preview column. */
  onClose?: () => void;
  /**
   * Navigate to the Context (Inbox) tab for the given file (or null to just open
   * the file list). Wired from the breadcrumb "Context" root and the empty state.
   */
  onJumpToContext?: (file: FileInfo | null) => void;
}

/**
 * Inline file preview shown beside the chat content on the project page.
 * Owns its own content-loading state and reuses {@link FileViewerPanel} so it
 * renders markdown/PDF/docs/HTML/media identically to the Inbox/Folder tab.
 */
export function FilePreview({
  file,
  surfaceClassName = 'bg-ds-bg-neutral-default-default',
  projectFiles = [],
  onClose,
  onJumpToContext,
}: FilePreviewProps) {
  const { t } = useTranslation();
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;

  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [isShowSourceCode, setIsShowSourceCode] = useState(false);

  // Mirror of the Inbox/Folder loader (selectedFileChange): read content via the
  // electron host (or remote fetch) and stash it on the file for the viewer.
  const loadFileContent = useCallback(
    (target: FileInfo, showSource?: boolean) => {
      const isWebMode = !ipcRenderer?.invoke;

      // Folders / archives are not previewable inline.
      if (target.isFolder || target.type === 'zip') {
        setSelectedFile(null);
        setLoading(false);
        return;
      }

      setSelectedFile(target);
      setLoading(true);

      if (target.isRemote && target.path?.startsWith('http')) {
        if (isImageFile(target)) {
          void fetchRemoteFileAsDataUrl(target.path)
            .then((content) => setSelectedFile({ ...target, content }))
            .catch((error) => {
              console.error('Failed to load remote image:', error);
              setSelectedFile({ ...target });
            })
            .finally(() => setLoading(false));
          return;
        }

        if (isAudioFile(target) || isVideoFile(target)) {
          setSelectedFile({ ...target });
          setLoading(false);
          return;
        }

        if (!isWebMode && ipcRenderer) {
          ipcRenderer
            .invoke('open-file', target.type, target.path, showSource)
            .then((res: string) => {
              setSelectedFile({ ...target, content: res });
              setLoading(false);
            })
            .catch((error: unknown) => {
              console.error('open-file error:', error);
              setLoading(false);
            });
          return;
        }

        void (async () => {
          try {
            const resp = await fetch(target.path);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const contentType = resp.headers.get('content-type') || '';
            let content: string;
            if (
              target.type === 'pdf' ||
              contentType.includes('application/pdf')
            ) {
              const blob = await resp.blob();
              content = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            } else {
              content = await resp.text();
            }
            setSelectedFile({ ...target, content });
          } catch (error) {
            console.error('Failed to load remote file:', error);
          } finally {
            setLoading(false);
          }
        })();
        return;
      }

      // PDF: use a data URL so the iframe can render it.
      if (target.type === 'pdf') {
        if (ipcRenderer) {
          ipcRenderer
            .invoke('read-file-dataurl', target.path)
            .then((dataUrl: string) => {
              setSelectedFile({ ...target, content: dataUrl });
              setLoading(false);
            })
            .catch((error: unknown) => {
              console.error('read-file-dataurl error:', error);
              setLoading(false);
            });
        } else {
          setLoading(false);
        }
        return;
      }

      // Audio/video: loaders read the file:// source themselves.
      if (isAudioFile(target) || isVideoFile(target)) {
        setSelectedFile({ ...target });
        setLoading(false);
        return;
      }

      if (ipcRenderer) {
        ipcRenderer
          .invoke('open-file', target.type, target.path, showSource)
          .then((res: string) => {
            setSelectedFile({ ...target, content: res });
            setLoading(false);
          })
          .catch((error: unknown) => {
            console.error('open-file error:', error);
            setLoading(false);
          });
      } else {
        setLoading(false);
      }
    },
    [ipcRenderer]
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
  }, [file?.path, file?.isRemote, loadFileContent]);

  // Breadcrumb is intentionally shallow: "Context > filename". The "Context"
  // root navigates to the Inbox/Context tab for this file.
  const contextLabel = t('layout.context-breadcrumb-root', {
    defaultValue: 'Context',
  });
  const breadcrumbSegments = useMemo(
    () => (selectedFile ? [contextLabel, selectedFile.name] : []),
    [selectedFile, contextLabel]
  );

  const handleBreadcrumbSegmentClick = useCallback(
    (index: number) => {
      if (index === 0) {
        onJumpToContext?.(selectedFile);
      }
    },
    [onJumpToContext, selectedFile]
  );

  const handleToggleSourceCode = useCallback(() => {
    if (!selectedFile) return;
    loadFileContent(selectedFile, !isShowSourceCode);
    setIsShowSourceCode((prev) => !prev);
  }, [selectedFile, isShowSourceCode, loadFileContent]);

  const handleRevealFile = useCallback(() => {
    if (!selectedFile) return;
    if (selectedFile.isRemote) {
      void downloadFromUrl(selectedFile.path, selectedFile.name);
      return;
    }
    ipcRenderer?.invoke('reveal-in-folder', selectedFile.path);
  }, [selectedFile, ipcRenderer]);

  const handleDownloadFile = useCallback(() => {
    if (!selectedFile || selectedFile.isFolder) return;
    void downloadOpenedFile(selectedFile);
  }, [selectedFile]);

  return (
    <FileViewerPanel
      selectedFile={selectedFile}
      loading={loading}
      isShowSourceCode={isShowSourceCode}
      breadcrumbSegments={breadcrumbSegments}
      onBreadcrumbSegmentClick={
        onJumpToContext ? handleBreadcrumbSegmentClick : undefined
      }
      projectFiles={projectFiles}
      surfaceClassName={surfaceClassName}
      onRevealFile={handleRevealFile}
      onDownloadFile={handleDownloadFile}
      onToggleSourceCode={handleToggleSourceCode}
      emptyState={
        <div className="gap-3 px-6 text-ds-text-neutral-muted-default flex h-full w-full flex-1 flex-col items-center justify-center text-center">
          <FileText className="h-12 w-12 text-ds-icon-neutral-muted-default" />
          <p className="text-sm">
            {t('chat.no-file-selected', {
              defaultValue: 'No file selected.',
            })}
          </p>
          {onJumpToContext ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onJumpToContext(null)}
            >
              {t('layout.jump-to-context-files', {
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
            <X className="h-4 w-4 text-ds-icon-neutral-muted-default" />
          </Button>
        ) : undefined
      }
    />
  );
}

export default FilePreview;
