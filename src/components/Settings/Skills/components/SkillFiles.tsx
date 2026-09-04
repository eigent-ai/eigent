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
  skillListFiles,
  skillReadFile,
  type SkillPackageFile,
} from '@/api/brain';
import {
  buildFileTree,
  FileTree,
  FileViewerPanel,
  type FileInfo,
} from '@/components/Folder';
import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { shellDetailBackState } from '@/lib/shellRoutes';
import { splitFrontmatter } from '@/lib/skillToolkit';
import { decideFilePreview } from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import type { SkillLibraryEntry } from '../skillLibrary';
import { spaceSkillSettingsUrl } from './SkillActions';

type GlobalSkillEntry = Exclude<SkillLibraryEntry, { kind: 'space' }>;
type LoadedSkillFile = { file: FileInfo; objectUrl: string };

const TEXT_FILE_TYPES = new Set([
  'css',
  'csv',
  'env',
  'go',
  'h',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'log',
  'md',
  'py',
  'rs',
  'sh',
  'sql',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

function fileName(relativePath: string) {
  return relativePath.split('/').filter(Boolean).at(-1) || relativePath;
}

function fileType(relativePath: string) {
  const name = fileName(relativePath);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLocaleLowerCase() : '';
}

function skillFileUrl(skillDirName: string, relativePath: string) {
  const query = new URLSearchParams({ path: relativePath });
  return `/skills/${encodeURIComponent(skillDirName)}/file?${query}`;
}

function toFileInfo(
  skillDirName: string,
  packageFile: SkillPackageFile
): FileInfo {
  return {
    name: fileName(packageFile.path),
    path: skillFileUrl(skillDirName, packageFile.path),
    relativePath: packageFile.path,
    type: fileType(packageFile.path),
    size: packageFile.size ?? undefined,
    mimeType: packageFile.mimeType ?? undefined,
    isRemote: true,
  };
}

function GlobalSkillPackage({
  entry,
  revision,
}: {
  entry: GlobalSkillEntry;
  revision: string | number;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState(false);
  const [inventoryRetry, setInventoryRetry] = useState(0);
  const [selectedPath, setSelectedPath] = useState('');
  const [loaded, setLoaded] = useState<LoadedSkillFile | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState(false);
  const [fileRetry, setFileRetry] = useState(0);
  const [source, setSource] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const treeId = useId();
  const skillDirName = entry.skill.skillDirName;

  useEffect(() => {
    let active = true;
    setInventoryLoading(true);
    setInventoryError(false);
    setFiles([]);

    const loadInventory = async () => {
      if (!skillDirName) throw new Error('Skill package has no folder');
      const result = await skillListFiles(skillDirName);
      if (!active) return;
      if (result?.success !== true) {
        throw new Error('Invalid skill package response');
      }
      const nextFiles = result.files
        .map((packageFile) => toFileInfo(skillDirName, packageFile))
        .sort((left, right) =>
          (left.relativePath || left.name).localeCompare(
            right.relativePath || right.name
          )
        );
      if (!nextFiles.length) throw new Error('Skill package is empty');
      setFiles(nextFiles);
      setSelectedPath((currentPath) => {
        if (
          currentPath &&
          nextFiles.some((file) => file.relativePath === currentPath)
        ) {
          return currentPath;
        }
        return (
          nextFiles.find((file) => file.relativePath === 'SKILL.md')
            ?.relativePath ||
          nextFiles[0]?.relativePath ||
          ''
        );
      });
      const folders = new Set<string>();
      for (const file of nextFiles) {
        const segments = (file.relativePath || '').split('/').filter(Boolean);
        for (let index = 1; index < segments.length; index += 1) {
          folders.add(segments.slice(0, index).join('/'));
        }
      }
      setExpandedFolders(folders);
    };
    void loadInventory()
      .catch(() => {
        if (active) setInventoryError(true);
      })
      .finally(() => {
        if (active) setInventoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [skillDirName, inventoryRetry, revision]);

  const selectedMetadata = useMemo(
    () => files.find((file) => file.relativePath === selectedPath) || null,
    [files, selectedPath]
  );

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setLoaded(null);
    setFileError(false);
    setSource(false);

    const loadFile = async () => {
      if (!skillDirName || !selectedMetadata?.relativePath) return;
      const decision = decideFilePreview(selectedMetadata.type, {
        size: selectedMetadata.size ?? null,
        mimeType: selectedMetadata.mimeType,
        supportsRanges: true,
      });
      if (
        decision.mode === 'blocked' ||
        (decision.mode === 'bounded-text' &&
          selectedMetadata.size !== undefined &&
          decision.limit !== null &&
          selectedMetadata.size > decision.limit)
      ) {
        setLoaded({
          file: {
            ...selectedMetadata,
            preview: {
              kind: 'blocked',
              reason: decision.reason || 'too-large',
              size: selectedMetadata.size ?? null,
              limit: decision.limit,
            },
          },
          objectUrl: '',
        });
        return;
      }

      setFileLoading(true);
      const blob = await skillReadFile(
        skillDirName,
        selectedMetadata.relativePath
      );
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      const shouldDecodeText =
        TEXT_FILE_TYPES.has(selectedMetadata.type) ||
        selectedMetadata.mimeType?.startsWith('text/') ||
        !selectedMetadata.type;
      const content = shouldDecodeText ? await blob.text() : objectUrl;
      if (!active) return;
      setLoaded({
        file: {
          ...selectedMetadata,
          path: shouldDecodeText ? selectedMetadata.path : objectUrl,
          content,
          size: blob.size,
        },
        objectUrl,
      });
    };

    void loadFile()
      .catch(() => {
        if (active) setFileError(true);
      })
      .finally(() => {
        if (active) setFileLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileRetry, selectedMetadata, skillDirName]);

  const hasLoadedSelected = loaded?.file.relativePath === selectedPath;
  const selectedFile = hasLoadedSelected ? loaded.file : selectedMetadata;
  const viewerLoading =
    fileLoading ||
    Boolean(selectedMetadata && !hasLoadedSelected && !fileError);
  const displayedFile = useMemo(() => {
    if (
      !selectedFile ||
      source ||
      selectedFile.relativePath !== 'SKILL.md' ||
      typeof selectedFile.content !== 'string'
    ) {
      return selectedFile;
    }
    return {
      ...selectedFile,
      content: splitFrontmatter(selectedFile.content).body,
    };
  }, [selectedFile, source]);
  const tree = useMemo(() => buildFileTree(files), [files]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const downloadSelected = useCallback(async () => {
    if (!skillDirName || !selectedMetadata?.relativePath) return;
    let objectUrl = loaded?.objectUrl;
    let release = false;
    try {
      if (!objectUrl) {
        objectUrl = URL.createObjectURL(
          await skillReadFile(skillDirName, selectedMetadata.relativePath)
        );
        release = true;
      }
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = selectedMetadata.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      setFileError(true);
    } finally {
      if (release && objectUrl) {
        const temporaryUrl = objectUrl;
        window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
      }
    }
  }, [loaded?.objectUrl, selectedMetadata, skillDirName]);

  if (inventoryLoading || inventoryError) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24 text-center"
        role={inventoryError ? 'alert' : 'status'}
      >
        <DsText>
          {t(
            inventoryError
              ? 'agents.library-files-failed'
              : 'agents.library-loading-files'
          )}
        </DsText>
        {inventoryError && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setInventoryRetry((value) => value + 1)}
          >
            {t('agents.library-retry')}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <FileViewerPanel
        selectedFile={fileError ? null : displayedFile}
        loading={viewerLoading}
        isShowSourceCode={source}
        breadcrumbSegments={[
          entry.name,
          ...(displayedFile?.relativePath || displayedFile?.name || '')
            .split('/')
            .filter(Boolean),
        ]}
        projectFiles={files.map((file) =>
          displayedFile && file.relativePath === displayedFile.relativePath
            ? displayedFile
            : file
        )}
        embedded
        isFileTreeOpen={treeOpen}
        onToggleFileTree={() => setTreeOpen((open) => !open)}
        fileTreeControlsId={treeId}
        emptyState={
          fileError ? (
            <div
              className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24 text-center"
              role="alert"
            >
              <DsText>{t('agents.library-files-failed')}</DsText>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFileRetry((value) => value + 1)}
              >
                {t('agents.library-retry')}
              </Button>
            </div>
          ) : undefined
        }
        onRevealFile={() => void downloadSelected()}
        onDownloadFile={() => void downloadSelected()}
        onToggleSourceCode={() => setSource((value) => !value)}
      />
      {treeOpen && (
        <aside
          className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-y-0 border-r-0 border-l border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default ${RIGHT_RAIL_CONTENT_WIDTH_CLASS}`}
          style={{ maxWidth: '50%' }}
          aria-label={t('chat.files', { defaultValue: 'Files' })}
        >
          <div className="flex h-ds-layout-row-header min-h-ds-layout-row-header shrink-0 items-center px-ds-12">
            <DsText as="span" weight="semibold">
              {t('chat.files', { defaultValue: 'Files' })}
            </DsText>
          </div>
          <div
            id={treeId}
            className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto px-ds-8 pb-ds-8"
          >
            <FileTree
              node={tree}
              selectedFile={displayedFile}
              expandedFolders={expandedFolders}
              onToggleFolder={toggleFolder}
              onSelectFile={(file) => {
                if (file.isFolder) {
                  toggleFolder(file.path);
                  return;
                }
                setSelectedPath(file.relativePath || file.path);
              }}
              isShowSourceCode={source}
            />
          </div>
        </aside>
      )}
    </div>
  );
}

export default function SkillFiles({
  entry,
  revision = 0,
}: {
  entry: SkillLibraryEntry;
  revision?: string | number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      data-skill-file-browser
    >
      {entry.kind === 'space' ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24 text-center"
          role="status"
        >
          <DsText>{t('agents.library-profile-files-unavailable')}</DsText>
          <DsText channel="code" role="small" className="break-all">
            {entry.ref}
          </DsText>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              navigate(spaceSkillSettingsUrl(entry.spaceId), {
                state: shellDetailBackState(
                  location.state as Record<string, unknown> | null,
                  `${location.pathname}${location.search}`
                ),
              })
            }
          >
            {t('agents.library-manage-profile')}
          </Button>
        </div>
      ) : (
        <GlobalSkillPackage
          key={JSON.stringify([
            entry.id,
            entry.skill.skillDirName,
            email,
            userId,
            revision,
          ])}
          entry={entry}
          revision={revision}
        />
      )}
    </div>
  );
}
