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

import cursorIcon from '@/assets/icon/cursor.svg';
import vsCodeIcon from '@/assets/icon/vs-code.svg';
import { RIGHT_RAIL_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { Skeleton } from '@/components/ui/skeleton';
import { TooltipSimple } from '@/components/ui/tooltip';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CodeXml,
  ExternalLink,
  Eye,
  File,
  FileArchive,
  FileCode,
  FileJson,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Image,
  MessageSquare,
  Music,
  PanelRight,
  PanelRightClose,
  Search,
  Table2,
  Video,
} from 'lucide-react';
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CsvPreviewTable } from './CsvPreviewTable';
import FolderComponent from './FolderComponent';

import { fetchGet, getBaseURL } from '@/api/http';
import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { SourceCodeViewer } from '@/components/CodeViewer/SourceCodeViewer';
import { getSidePanelOutputFilesRevision } from '@/components/Session/SidePanel/sections/collectSidePanelOutputFiles';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';
import { loadFilePreview, toLocalPreviewUrl } from '@/lib/filePreviewLoader';
import {
  deferInlineScriptsUntilLoad,
  injectFontStyles,
} from '@/lib/htmlFontStyles';
import {
  inlineLocalHtmlImgElements,
  inlineLocalHtmlScriptElements,
  inlineLocalProjectImagePaths,
  toLocalFileUrl,
} from '@/lib/htmlLocalAssets';
import {
  collectPreviewRemoteOrigins,
  containsDangerousContent,
  injectPreviewContentSecurityPolicy,
  repairGeneratedReportBraces,
} from '@/lib/htmlSanitization';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
import { cn } from '@/lib/utils';
import {
  normalizeWorkspaceRelativePath,
  resolveWorkspaceFilePath,
} from '@/lib/workspaceRelativePath';
import { resolveArtifactAssetFile } from '@/service/artifactAssetApi';
import {
  formatFileSize,
  type FilePreviewPayload,
} from '@/shared/filePreviewContract';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ZoomControls } from './ZoomControls';

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'heic',
  'avif',
];
const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'ogg',
  'flac',
  'aac',
  'm4a',
  'wma',
  'opus',
  'm4b',
  'aiff',
  'alac',
];
const VIDEO_EXTENSIONS = [
  'mp4',
  'webm',
  'mov',
  'avi',
  'mkv',
  'flv',
  'wmv',
  'm4v',
  'mpg',
  'mpeg',
  '3gp',
  'ogv',
];

const ARCHIVE_EXTENSIONS = [
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'bz2',
  'xz',
  'tgz',
  'lz4',
  'zst',
];

const CODE_EXTENSIONS = [
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'java',
  'go',
  'rs',
  'cpp',
  'cc',
  'cxx',
  'c',
  'h',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'kt',
  'kts',
  'sql',
  'vue',
  'svelte',
  'wasm',
  'ps1',
  'bat',
  'cmd',
  'gradle',
  'cmake',
  'make',
  'dockerfile',
];

const MARKUP_STYLE_EXTENSIONS = [
  'html',
  'htm',
  'xml',
  'css',
  'scss',
  'sass',
  'less',
  'yaml',
  'yml',
];

/** Office / binary documents — use generic {@link File} icon */
const DOCUMENT_EXTENSIONS = [
  'pdf',
  'doc',
  'docx',
  'odt',
  'ppt',
  'pptx',
  'odp',
  'key',
  'pages',
  'rtf',
];

const PLAIN_TEXT_EXTENSIONS = [
  'txt',
  'md',
  'markdown',
  'log',
  'rst',
  'adoc',
  'tex',
];

const SPREADSHEET_EXTENSIONS = ['xls', 'xlsx', 'csv', 'ods', 'tsv'];

type FileTypeTarget = {
  name?: string;
  path?: string;
  type?: string;
};
const loggedFileTypeWarnings = new Set<string>();

function getExt(value?: string) {
  if (!value) return '';
  const normalized = value.split(/[?#]/)[0];
  const lastSegment = normalized.split('/').pop() || normalized;
  if (!lastSegment.includes('.')) return '';
  return lastSegment.split('.').pop()?.toLowerCase() || '';
}

function getFileType(file: FileTypeTarget) {
  const extFromNameOrPath = getExt(file.name) || getExt(file.path);
  const normalizedType = (file.type || '').replace(/^\./, '').toLowerCase();
  const fileId = file.path || file.name || 'unknown-file';

  if (!extFromNameOrPath && normalizedType) {
    const key = `missing-ext|${fileId}|${normalizedType}`;
    if (!loggedFileTypeWarnings.has(key)) {
      loggedFileTypeWarnings.add(key);
      console.warn(
        `[Folder getFileType] extension missing in name/path, file.type fallback disabled: ${fileId} (type=${normalizedType})`
      );
    }
  }

  if (
    extFromNameOrPath &&
    normalizedType &&
    normalizedType !== 'folder' &&
    extFromNameOrPath !== normalizedType
  ) {
    const key = `mismatch|${fileId}|${extFromNameOrPath}|${normalizedType}`;
    if (!loggedFileTypeWarnings.has(key)) {
      loggedFileTypeWarnings.add(key);
      console.warn(
        `[Folder getFileType] extension/type mismatch for ${fileId}: inferred=${extFromNameOrPath}, type=${normalizedType}`
      );
    }
  }

  return extFromNameOrPath;
}

function workingFolderBasename(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function treeSegmentLabel(value?: string | null, fallback = 'Session') {
  const trimmed = (value || '').trim();
  return (trimmed || fallback).replace(/[\\/]/g, '-');
}

export function isImageFile(file: FileTypeTarget) {
  return IMAGE_EXTENSIONS.includes(getFileType(file));
}
export function isAudioFile(file: FileTypeTarget) {
  return AUDIO_EXTENSIONS.includes(getFileType(file));
}
export function isVideoFile(file: FileTypeTarget) {
  return VIDEO_EXTENSIONS.includes(getFileType(file));
}

function isArchiveFile(file: FileTypeTarget) {
  return ARCHIVE_EXTENSIONS.includes(getFileType(file));
}

function isCodeLikeFile(file: FileTypeTarget) {
  const ext = getFileType(file);
  if (!ext) return false;
  if (CODE_EXTENSIONS.includes(ext)) return true;
  if (MARKUP_STYLE_EXTENSIONS.includes(ext)) return true;
  return false;
}

/** Leading icon for file tree leaves (when no custom `icon` on the node). */
function getLeafFileTreeIcon(file: FileTypeTarget): LucideIcon {
  if (isImageFile(file)) return Image;
  if (isVideoFile(file)) return Video;
  if (isAudioFile(file)) return Music;
  if (isArchiveFile(file)) return FileArchive;

  const ext = getFileType(file);
  if (!ext) return File;

  if (ext === 'json' || ext === 'jsonl' || ext === 'jsonc') return FileJson;
  if (isCodeLikeFile(file)) return FileCode;
  if (SPREADSHEET_EXTENSIONS.includes(ext)) return Table2;
  if (DOCUMENT_EXTENSIONS.includes(ext)) return File;
  if (PLAIN_TEXT_EXTENSIONS.includes(ext)) return FileText;

  return File;
}

// Type definitions
export type FileTreeStatus = 'added' | 'modified' | 'deleted';

export interface FileTreeNode {
  name: string;
  path: string;
  type?: string;
  projectId?: string;
  isFolder?: boolean;
  icon?: React.ElementType;
  children?: FileTreeNode[];
  isRemote?: boolean;
  relativePath?: string;
  status?: FileTreeStatus;
}

function filterFileTree(node: FileTreeNode, query: string): FileTreeNode {
  const q = query.trim().toLowerCase();
  if (!q || !node.children?.length) {
    return node;
  }

  const nodeMatches = (candidate: FileTreeNode) =>
    [candidate.name, candidate.relativePath, candidate.path]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));

  const filteredChildren: FileTreeNode[] = [];
  for (const child of node.children) {
    if (child.isFolder) {
      if (nodeMatches(child)) {
        filteredChildren.push(child);
        continue;
      }
      const filtered = filterFileTree(child, query);
      if (filtered.children?.length) {
        filteredChildren.push(filtered);
      }
    } else if (nodeMatches(child)) {
      filteredChildren.push(child);
    }
  }
  return { ...node, children: filteredChildren };
}

function collectExpandableFolderPaths(node: FileTreeNode): Set<string> {
  const paths = new Set<string>();
  const visit = (candidate: FileTreeNode) => {
    for (const child of candidate.children ?? []) {
      if (!child.isFolder) continue;
      if (child.children?.length) paths.add(child.path);
      visit(child);
    }
  };
  visit(node);
  return paths;
}

export interface FileInfo {
  name: string;
  path: string;
  type: string;
  projectId?: string;
  isFolder?: boolean;
  icon?: React.ElementType;
  content?: string;
  relativePath?: string;
  isRemote?: boolean;
  status?: FileTreeStatus;
  size?: number;
  modifiedAt?: number;
  supportsRanges?: boolean;
  mimeType?: string;
  preview?: FilePreviewPayload;
}

type ProjectFetchTarget = {
  id: string;
  name: string;
};

function getNormalizedTreeRelativePath(file: FileInfo): string {
  const rel = (file.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const name = (file.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel) {
    const relBasename = rel.split('/').filter(Boolean).at(-1);
    return relBasename === name || !name ? rel : `${rel}/${name}`;
  }
  return name || (file.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function getComparableRelativePath(file?: FileInfo | null): string {
  if (!file) return '';
  return getNormalizedTreeRelativePath(file).toLowerCase();
}

export function isSameFileIdentity(
  left?: FileInfo | null,
  right?: FileInfo | null
): boolean {
  if (!left || !right) return false;
  const leftRel = getComparableRelativePath(left);
  const rightRel = getComparableRelativePath(right);
  if (leftRel && rightRel) return leftRel === rightRel;
  return left.path === right.path;
}

/** Build a nested {@link FileTreeNode} tree from a flat file list. */
export function buildFileTree(files: FileInfo[]): FileTreeNode {
  const root: FileTreeNode = {
    name: 'root',
    path: '',
    children: [],
    isFolder: true,
  };

  const folderMap = new Map<string, FileTreeNode>();
  folderMap.set('', root);

  const ensureFolderNode = (
    segments: string[],
    source?: Pick<FileInfo, 'isRemote' | 'projectId'>
  ): FileTreeNode => {
    let parentNode = root;
    let currentFolderPath = '';

    for (const segment of segments) {
      currentFolderPath = currentFolderPath
        ? `${currentFolderPath}/${segment}`
        : segment;

      let folderNode = folderMap.get(currentFolderPath);
      if (!folderNode) {
        folderNode = {
          name: segment,
          path: currentFolderPath,
          isFolder: true,
          children: [],
          relativePath: currentFolderPath,
          isRemote: source?.isRemote,
          projectId: source?.projectId,
        };
        parentNode.children!.push(folderNode);
        folderMap.set(currentFolderPath, folderNode);
      }

      if (source?.isRemote) folderNode.isRemote = true;
      if (!folderNode.projectId && source?.projectId) {
        folderNode.projectId = source.projectId;
      }

      parentNode = folderNode;
    }

    return parentNode;
  };

  const sortedFiles = [...files].sort((left, right) => {
    const leftRelativePath = getNormalizedTreeRelativePath(left);
    const rightRelativePath = getNormalizedTreeRelativePath(right);
    const leftDepth = leftRelativePath.split('/').filter(Boolean).length;
    const rightDepth = rightRelativePath.split('/').filter(Boolean).length;

    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return leftRelativePath.localeCompare(rightRelativePath);
  });

  for (const file of sortedFiles) {
    const normalizedRelativePath = getNormalizedTreeRelativePath(file);
    const pathSegments = normalizedRelativePath.split('/').filter(Boolean);
    if (!pathSegments.length) continue;

    if (file.isFolder) {
      ensureFolderNode(pathSegments, file);
      continue;
    }

    const folderSegments = pathSegments.slice(0, -1);
    const fileName = pathSegments[pathSegments.length - 1] || file.name;
    const parentNode = ensureFolderNode(folderSegments, file);

    parentNode.children!.push({
      name: fileName || file.name,
      path: file.path,
      type: file.type,
      projectId: file.projectId,
      isFolder: file.isFolder,
      icon: file.icon,
      children: file.isFolder ? [] : undefined,
      isRemote: file.isRemote,
      relativePath: file.relativePath,
      status: file.status,
    });
  }

  const sortTree = (node: FileTreeNode) => {
    if (!node.children?.length) return;

    node.children.sort((left, right) => {
      if (!!left.isFolder !== !!right.isFolder) {
        return left.isFolder ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

    node.children.forEach(sortTree);
  };

  sortTree(root);
  return root;
}

export function findMatchingFile(
  files: FileInfo[],
  target?: FileInfo | null
): FileInfo | undefined {
  if (!target) return undefined;

  const pathMatch = files.find((file) => file.path === target.path);
  if (pathMatch) return pathMatch;

  const targetRelativePath = getComparableRelativePath(target);
  if (targetRelativePath) {
    const relativePathMatch = files.find(
      (file) => getComparableRelativePath(file) === targetRelativePath
    );
    if (relativePathMatch) return relativePathMatch;
  }

  if (target.name) {
    const sameNameMatches = files.filter((file) => file.name === target.name);
    if (sameNameMatches.length === 1) return sameNameMatches[0];
  }

  return undefined;
}

function getAncestorFolderPathsForFile(file?: FileInfo | null): string[] {
  if (!file || file.isFolder) return [];
  if (!file.relativePath && /^(https?:|file:|blob:|data:)/i.test(file.path)) {
    return [];
  }

  const segments = getNormalizedTreeRelativePath(file)
    .split('/')
    .filter(Boolean);
  if (segments.length <= 1) return [];

  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join('/'));
}

/** Breadcrumb: project root label → parent folders (from `relativePath`) → file name. */
export function getFileBreadcrumbSegments(
  file: FileInfo,
  options: {
    projectRootLabel: string;
    remoteRootLabel: string;
    useProjectRootForRemote?: boolean;
  }
): string[] {
  const segments = getNormalizedTreeRelativePath(file)
    .split('/')
    .filter(Boolean);
  if (file.isRemote && !options.useProjectRootForRemote) {
    return [
      options.remoteRootLabel,
      ...(segments.length ? segments : [file.name]),
    ];
  }
  return [options.projectRootLabel, ...segments];
}

// FileTree component to render nested file structure
export interface FileTreeProps {
  node: FileTreeNode;
  level?: number;
  selectedFile: FileInfo | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: FileInfo) => void;
  isShowSourceCode: boolean;
  /** Review keeps the Context tree layout and adds change-status markers. */
  variant?: 'default' | 'review';
  /** Review-only identities that the user has explicitly marked as read. */
  reviewedFileIds?: ReadonlySet<string>;
  /** Review-only pending comment count keyed by the adapted file identity. */
  reviewCommentCounts?: ReadonlyMap<string, number>;
}

const FILE_TREE_STATUS_META: Record<
  FileTreeStatus,
  { letter: string; className: string }
> = {
  added: { letter: 'A', className: 'text-ds-text-success-default-default' },
  modified: {
    letter: 'M',
    className: 'text-ds-text-warning-default-default',
  },
  deleted: { letter: 'D', className: 'text-ds-text-error-default-default' },
};

export const FileTree: React.FC<FileTreeProps> = ({
  node,
  level = 0,
  selectedFile,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  isShowSourceCode,
  variant = 'default',
  reviewedFileIds,
  reviewCommentCounts,
}) => {
  const { t } = useTranslation();
  if (!node.children || node.children.length === 0) return null;

  return (
    <div
      className="min-w-0"
      role={level === 0 ? 'tree' : 'group'}
      aria-label={level === 0 ? 'Files' : undefined}
    >
      {node.children.map((child) => {
        const isExpanded = expandedFolders.has(child.path);
        const hasNested = Boolean(
          child.isFolder && isExpanded && child.children?.length
        );
        const fileInfo: FileInfo = {
          name: child.name,
          path: child.path,
          type: child.type || '',
          projectId: child.projectId,
          isFolder: child.isFolder,
          icon: child.icon,
          isRemote: child.isRemote,
          relativePath: child.relativePath,
          status: child.status,
        };

        const isRowSelected =
          variant === 'review'
            ? selectedFile?.path === fileInfo.path
            : isSameFileIdentity(selectedFile, fileInfo);
        const status = child.status
          ? FILE_TREE_STATUS_META[child.status]
          : null;
        const isReviewed = reviewedFileIds?.has(child.path) ?? false;
        const reviewCommentCount = reviewCommentCounts?.get(child.path) ?? 0;
        const rowIconClass = `size-4 shrink-0 ${
          isRowSelected
            ? 'text-ds-ink-default-default'
            : 'text-ds-ink-muted-default'
        }`;

        return (
          <div key={child.path} className="min-w-0">
            {child.isFolder ? (
              <div
                role="treeitem"
                aria-expanded={isExpanded}
                aria-selected={isRowSelected}
                className={cn(
                  'mb-1 flex w-full min-w-0 items-center rounded-lg px-1 py-0.5 transition-colors hover:bg-ds-neutral-subtle-hover',
                  isRowSelected
                    ? 'bg-ds-neutral-default-default text-ds-ink-default-default'
                    : 'bg-transparent text-ds-ink-muted-default'
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggleFolder(child.path)}
                  aria-label={
                    isExpanded
                      ? t('folder.collapse-folder', {
                          name: child.name,
                          defaultValue: 'Collapse {{name}}',
                        })
                      : t('folder.expand-folder', {
                          name: child.name,
                          defaultValue: 'Expand {{name}}',
                        })
                  }
                  className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 border-x-0 border-y-0 bg-transparent text-inherit hover:bg-ds-neutral-default-default focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none"
                >
                  {isExpanded ? (
                    <ChevronDown className={rowIconClass} />
                  ) : (
                    <ChevronRight className={rowIconClass} />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    variant === 'review'
                      ? onToggleFolder(child.path)
                      : onSelectFile(fileInfo)
                  }
                  className="flex h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md border-0 border-x-0 border-y-0 bg-transparent px-1 text-left text-inherit focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none"
                >
                  <FolderIcon className={rowIconClass} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-left text-ds-text-base leading-normal font-medium">
                    {child.name}
                  </span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                role="treeitem"
                aria-selected={isRowSelected}
                onClick={() => onSelectFile(fileInfo)}
                className={cn(
                  'mb-1 flex w-full min-w-0 cursor-pointer flex-row items-center justify-start gap-2 rounded-lg border-0 border-x-0 border-y-0 px-2 py-1.5 text-left transition-colors hover:bg-ds-neutral-subtle-hover focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none',
                  isRowSelected
                    ? 'bg-ds-neutral-default-default text-ds-ink-default-default'
                    : 'bg-transparent text-ds-ink-muted-default'
                )}
              >
                {createElement(
                  child.icon ??
                    getLeafFileTreeIcon({
                      name: child.name,
                      path: child.path,
                      type: child.type,
                    }),
                  { className: rowIconClass, 'aria-hidden': true }
                )}
                <span className="min-w-0 flex-1 truncate text-left text-ds-text-base leading-normal font-medium">
                  {child.name}
                </span>
                {variant === 'review' && status ? (
                  <span
                    className={`w-4 shrink-0 text-center text-ds-text-meta font-bold ${status.className}`}
                    aria-label={child.status}
                  >
                    {status.letter}
                  </span>
                ) : null}
                {variant === 'review' && isReviewed ? (
                  <DsIcon
                    icon={CheckCircle2}
                    recipe="main-compact"
                    decorative={false}
                    className="text-ds-icon-success-default-default"
                    aria-label={t('folder.reviewed', {
                      defaultValue: 'Reviewed',
                    })}
                  />
                ) : null}
                {variant === 'review' && reviewCommentCount > 0 ? (
                  <span
                    className="min-w-ds-control-2xs inline-flex min-h-ds-control-2xs shrink-0 items-center justify-center gap-ds-2 rounded-full bg-ds-accent-subtle-default px-ds-4 text-ds-text-meta font-semibold text-ds-ink-default-default"
                    aria-label={t('folder.review-comment-count', {
                      count: reviewCommentCount,
                      defaultValue_one: '{{count}} review comment',
                      defaultValue_other: '{{count}} review comments',
                    })}
                  >
                    <DsIcon icon={MessageSquare} recipe="main-compact" />
                    {reviewCommentCount}
                  </span>
                ) : null}
              </button>
            )}

            {hasNested ? (
              <div className="ml-4 border-y-0 border-r-0 border-l border-solid border-ds-hairline-subtle-default pl-1">
                <FileTree
                  node={child}
                  level={level + 1}
                  selectedFile={selectedFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                  isShowSourceCode={isShowSourceCode}
                  variant={variant}
                  reviewedFileIds={reviewedFileIds}
                  reviewCommentCounts={reviewCommentCounts}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

function triggerBlobDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function parseFilenameFromContentDisposition(
  header: string | null
): string | undefined {
  if (!header) return undefined;
  const utf8 = /filename\*=UTF-8''([^;\s]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename=([^;\s]+)/i.exec(header);
  if (plain?.[1]) return plain[1].replace(/^["']|["']$/g, '');
  return undefined;
}

const TEXT_DOWNLOAD_TYPES = new Set([
  'md',
  'txt',
  'json',
  'xml',
  'csv',
  'html',
  'css',
  'js',
  'ts',
  'tsx',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'yml',
  'yaml',
  'sh',
  'env',
  'log',
  'sql',
  'graphql',
  'rs',
  'go',
  'java',
  'c',
  'cpp',
  'h',
  'cs',
  'rb',
  'php',
  'swift',
  'kt',
]);

function mimeFromFileType(type: string): string {
  const lower = type.toLowerCase();
  const map: Record<string, string> = {
    md: 'text/markdown',
    txt: 'text/plain',
    json: 'application/json',
    html: 'text/html',
    csv: 'text/csv',
    css: 'text/css',
    js: 'text/javascript',
    ts: 'text/typescript',
    tsx: 'text/typescript',
    jsx: 'text/javascript',
    xml: 'application/xml',
    yml: 'text/yaml',
    yaml: 'text/yaml',
  };
  return map[lower] ?? 'text/plain';
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/** Web-only: fetch URL or path (same-origin relative) and save with the given name. */
export async function downloadFromUrl(
  url: string | undefined,
  suggestedFilename: string
): Promise<void> {
  const trimmed = url?.trim();
  if (!trimmed) return;

  const fallbackName =
    suggestedFilename ||
    (() => {
      try {
        return (
          new URL(trimmed, window.location.href).pathname.split('/').pop() ||
          'download'
        );
      } catch {
        return 'download';
      }
    })();

  const tryFetchAsBlob = async (): Promise<boolean> => {
    try {
      const response = await fetch(trimmed, { credentials: 'same-origin' });
      if (!response.ok) return false;
      const blob = await response.blob();
      const filename =
        parseFilenameFromContentDisposition(
          response.headers.get('Content-Disposition')
        ) ?? fallbackName;
      triggerBlobDownload(blob, filename);
      return true;
    } catch {
      return false;
    }
  };

  if (/^https?:\/\//i.test(trimmed)) {
    if (await tryFetchAsBlob()) return;
    window.open(trimmed, '_blank', 'noopener,noreferrer');
    return;
  }

  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    await tryFetchAsBlob();
    return;
  }

  console.warn(
    'downloadFromUrl: path is not fetchable in the browser (use an http(s) or same-origin URL):',
    trimmed
  );
}

/** Web-first download for the file viewer: prefers in-memory content, then fetchable URL. */
export async function downloadOpenedFile(file: FileInfo): Promise<void> {
  if (file.isFolder || (!file.path && file.content === undefined)) return;

  // A blocked preview must never fall back to fetch(...).blob(), because that
  // would reintroduce an unbounded renderer allocation for the exact files the
  // preview policy rejected. Let the browser/OS own the transfer instead.
  if (file.preview?.kind === 'blocked') {
    if (file.isRemote && file.path) {
      window.open(file.path, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  const filename = file.name || 'download';
  const content = file.content;

  if (typeof content === 'string') {
    if (content.startsWith('data:')) {
      const blob = await blobFromDataUrl(content);
      triggerBlobDownload(blob, filename);
      return;
    }
    if (content.startsWith('blob:')) {
      const anchor = document.createElement('a');
      anchor.href = content;
      anchor.download = filename;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }
    if (TEXT_DOWNLOAD_TYPES.has(file.type) && content.length > 0) {
      triggerBlobDownload(
        new Blob([content], { type: mimeFromFileType(file.type) }),
        filename
      );
      return;
    }
  }

  await downloadFromUrl(file.path, filename);
}

export interface FileViewerOpenAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

interface FolderProps {
  data?: Agent;
  spaceId?: string;
}

export default function Folder({ data: _data, spaceId }: FolderProps) {
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const authStore = useAuthStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeProjectId = spaceId ? null : projectStore.activeProjectId;
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const resolvedSpaceId =
    spaceId || activeProjectMeta?.spaceId || activeSpaceId || undefined;
  const activeSpace = useSpaceStore((s) => {
    return resolvedSpaceId ? (s.spaces[resolvedSpaceId] ?? null) : null;
  });
  const projectsBySpaceId = useSpaceStore((s) => s.projectsBySpaceId);
  const spaceProjects = useMemo(() => {
    if (!resolvedSpaceId) return [];
    return Object.values(projectsBySpaceId[resolvedSpaceId] ?? {}).filter(
      (project) => project.status !== 'archived'
    );
  }, [projectsBySpaceId, resolvedSpaceId]);
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const electronAPI = host?.electronAPI;
  const isDesktopHost = Boolean(electronAPI && ipcRenderer);
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [isShowSourceCode, setIsShowSourceCode] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [workingFolderPath, setWorkingFolderPath] = useState<string | null>(
    null
  );
  const [fileTree, setFileTree] = useState<FileTreeNode>({
    name: 'root',
    path: '',
    children: [],
    isFolder: true,
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set()
  );
  const [fileGroups, setFileGroups] = useState<
    {
      folder: string;
      files: FileInfo[];
    }[]
  >([
    {
      folder: 'Reports',
      files: [],
    },
  ]);
  const fileListRef = useRef<FileInfo[]>([]);
  const hasFetchedRemote = useRef(false);
  const lastFetchKey = useRef<string>('');
  const previewRequestRef = useRef<AbortController | null>(null);
  const fileTreeControlsId = useId();
  const [isFileSidebarOpen, setIsFileSidebarOpen] = useState(true);
  const hasNoFiles = fileGroups.every((group) => group.files.length === 0);

  const rememberSelectedFile = (file: FileInfo) => {
    if (file.isFolder) return;
    if (spaceId) return;
    if (!chatStore?.activeTaskId) return;
    chatStore.setSelectedFile(chatStore.activeTaskId, file);
  };

  const activeTaskId = spaceId
    ? undefined
    : (chatStore?.activeTaskId ?? undefined);
  const activeTask = activeTaskId ? chatStore?.tasks[activeTaskId] : undefined;
  const sidebarFileTree = useMemo(
    () => filterFileTree(fileTree, fileSearchQuery),
    [fileSearchQuery, fileTree]
  );
  const visibleExpandedFolders = useMemo(
    () =>
      fileSearchQuery.trim()
        ? collectExpandableFolderPaths(sidebarFileTree)
        : expandedFolders,
    [expandedFolders, fileSearchQuery, sidebarFileTree]
  );

  const selectedFileChange = (file: FileInfo, isShowSourceCode?: boolean) => {
    if (file.isFolder || getFileType(file) === 'zip') {
      previewRequestRef.current?.abort();
      setSelectedFile(file);
      setLoading(false);
      setIsShowSourceCode(false);
      rememberSelectedFile(file);
      return;
    }
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    setSelectedFile(file);
    if (!isSameFileIdentity(selectedFile, file)) {
      setIsShowSourceCode(Boolean(isShowSourceCode));
    }
    setLoading(true);
    void resolveArtifactAssetFile(file)
      .then((resolvedFile) =>
        loadFilePreview(resolvedFile, {
          ipcRenderer,
          showSource: isShowSourceCode,
          signal: controller.signal,
        })
      )
      .then((loadedFile) => {
        if (controller.signal.aborted) return;
        setSelectedFile(loadedFile);
        rememberSelectedFile(file);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error('Failed to load file preview:', error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
  };

  useEffect(
    () => () => {
      previewRequestRef.current?.abort();
    },
    []
  );

  const isShowSourceCodeChange = () => {
    setIsShowSourceCode((current) => !current);
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  };

  const projectedFileRevision = useMemo(
    () => getSidePanelOutputFilesRevision(activeTask),
    [activeTask]
  );
  const projectId = (activeProjectId as string) || activeTaskId || '';
  const fileSpaceId = resolvedSpaceId;
  const useBrainWorkspaceFiles = Boolean(fileSpaceId && activeSpace?.rootPath);
  const useSpaceScopedRemoteFiles = !isLocalWorkspaceSpace(activeSpace);
  const projectFetchTargets: ProjectFetchTarget[] = useMemo(() => {
    if (useSpaceScopedRemoteFiles && fileSpaceId) {
      const targets = spaceProjects.length
        ? spaceProjects
        : activeProjectMeta
          ? [activeProjectMeta]
          : [];
      return targets
        .filter((project) => project.id)
        .map((project) => ({
          id: project.id,
          name: treeSegmentLabel(project.name, project.id),
        }));
    }
    const targetProjectId =
      projectId || (useBrainWorkspaceFiles ? fileSpaceId : '');
    return targetProjectId
      ? [
          {
            id: targetProjectId,
            name: treeSegmentLabel(activeProjectMeta?.name, targetProjectId),
          },
        ]
      : [];
  }, [
    activeProjectMeta,
    fileSpaceId,
    projectId,
    spaceProjects,
    useBrainWorkspaceFiles,
    useSpaceScopedRemoteFiles,
  ]);
  const projectFetchKey = projectFetchTargets
    .map((project) => project.id)
    .join(',');
  const projectFetchTargetsRef =
    useRef<ProjectFetchTarget[]>(projectFetchTargets);
  const fetchKey = `${fileSpaceId || ''}|${useSpaceScopedRemoteFiles ? 'space' : 'project'}|${projectFetchKey}|${activeTaskId || ''}|${projectedFileRevision}`;
  const fileContextResetKey =
    useSpaceScopedRemoteFiles || useBrainWorkspaceFiles
      ? fileSpaceId
      : activeTaskId;
  // Reset state when the file context changes.
  useEffect(() => {
    hasFetchedRemote.current = false;
    setSelectedFile(null);
    setFileTree({ name: 'root', path: '', children: [], isFolder: true });
    setFileGroups([{ folder: 'Reports', files: [] }]);
    fileListRef.current = [];
    setExpandedFolders(new Set());
  }, [fileContextResetKey]);

  useEffect(() => {
    projectFetchTargetsRef.current = projectFetchTargets;
  }, [projectFetchTargets]);

  useEffect(() => {
    let cancelled = false;
    const loadPath = async () => {
      if (activeSpace?.rootPath) {
        setWorkingFolderPath(activeSpace.rootPath);
        return;
      }
      setWorkingFolderPath(null);
      if (!authStore.email || !activeProjectId) {
        return;
      }
      if (typeof electronAPI?.getProjectFolderPath !== 'function') {
        return;
      }
      try {
        const folderPath = await electronAPI.getProjectFolderPath(
          authStore.email,
          activeProjectId,
          authStore.user_id
        );
        if (!cancelled) setWorkingFolderPath(folderPath || null);
      } catch {
        if (!cancelled) setWorkingFolderPath(null);
      }
    };
    void loadPath();
    return () => {
      cancelled = true;
    };
  }, [
    activeSpace?.rootPath,
    authStore.email,
    authStore.user_id,
    activeProjectId,
    electronAPI,
  ]);

  const expandFoldersForFile = (file?: FileInfo | null) => {
    const folderPaths = getAncestorFolderPathsForFile(file);
    if (folderPaths.length === 0) return;

    setExpandedFolders((prev) => {
      let changed = false;
      const next = new Set(prev);
      folderPaths.forEach((folderPath) => {
        if (!next.has(folderPath)) {
          next.add(folderPath);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  };

  useEffect(() => {
    if (
      (!chatStore && !useSpaceScopedRemoteFiles && !useBrainWorkspaceFiles) ||
      !projectFetchTargetsRef.current.length ||
      !authStore.email
    ) {
      setFilesLoading(false);
      return;
    }

    let cancelled = false;

    const setFileList = async (
      options: {
        targets?: ProjectFetchTarget[];
        signal?: AbortSignal;
        merge?: boolean;
      } = {}
    ): Promise<boolean> => {
      const fetchTargets = options.targets ?? projectFetchTargetsRef.current;
      const signal = options.signal;
      if (cancelled || signal?.aborted || fetchTargets.length === 0) {
        return false;
      }

      let res: FileInfo[] = [];
      const primaryProjectId = fetchTargets[0]?.id || projectId;

      if (
        ipcRenderer &&
        !useSpaceScopedRemoteFiles &&
        !useBrainWorkspaceFiles
      ) {
        try {
          const localFiles = await ipcRenderer.invoke(
            'get-project-file-list',
            authStore.email,
            primaryProjectId,
            authStore.user_id
          );
          if (cancelled || signal?.aborted) return false;
          if (Array.isArray(localFiles)) {
            res = localFiles.map((file: FileInfo) => ({
              ...file,
              projectId: file.projectId || primaryProjectId,
            }));
          }
        } catch (error) {
          console.warn('[Folder] Failed to fetch local project files:', error);
        }
      }

      if (
        !res.length ||
        !ipcRenderer ||
        useSpaceScopedRemoteFiles ||
        useBrainWorkspaceFiles
      ) {
        try {
          const baseURL = await getBaseURL();
          if (!baseURL) {
            console.warn('[Folder] Brain not connected, cannot fetch files');
          } else {
            const lists = await Promise.all(
              fetchTargets.map(async (target) => {
                const listRes = await fetchGet(
                  '/files',
                  {
                    project_id: target.id,
                    email: authStore.email,
                    ...(fileSpaceId ? { space_id: fileSpaceId } : {}),
                    ...(authStore.user_id != null
                      ? { user_id: String(authStore.user_id) }
                      : {}),
                  },
                  undefined,
                  { signal }
                );
                return { target, listRes };
              })
            );
            if (cancelled || signal?.aborted) return false;

            res = lists.flatMap(({ target, listRes }) => {
              if (!Array.isArray(listRes)) return [];
              return listRes.map((item: any) => {
                const filename = item.filename || '';
                const url = item.url?.startsWith('http')
                  ? item.url
                  : `${baseURL}${item.url || ''}`;
                const relativePath =
                  item.relativePath || item.relative_path || filename;
                return {
                  name: filename,
                  type: filename.split('.').pop() || '',
                  path: url,
                  projectId: target.id,
                  relativePath: useSpaceScopedRemoteFiles
                    ? `${target.name}/${relativePath}`
                    : relativePath,
                  isRemote: true,
                  size:
                    typeof item.size === 'number' && item.size >= 0
                      ? item.size
                      : undefined,
                  modifiedAt:
                    typeof item.modifiedAt === 'number'
                      ? item.modifiedAt
                      : undefined,
                  supportsRanges: item.supportsRanges === true,
                };
              });
            });
          }
        } catch (error: any) {
          if (cancelled || signal?.aborted || error?.name === 'AbortError') {
            return false;
          }
          console.warn('[Folder] Failed to fetch files from Brain:', error);
        }
      }

      if (cancelled || signal?.aborted) return false;
      const visibleFiles = filterVisibleAgentFiles(res);
      const fetchedTargetIds = new Set(fetchTargets.map((target) => target.id));
      const fetchedTargetNames = new Set(
        fetchTargets.map((target) => target.name)
      );
      const shouldRemoveForTargets = (file: FileInfo) => {
        if (!options.merge) return false;
        if (!useSpaceScopedRemoteFiles && !useBrainWorkspaceFiles) return true;
        if (file.projectId && fetchedTargetIds.has(file.projectId)) return true;
        const rootSegment = getNormalizedTreeRelativePath(file)
          .split('/')
          .filter(Boolean)[0];
        return Boolean(rootSegment && fetchedTargetNames.has(rootSegment));
      };
      const nextVisibleFiles = options.merge
        ? [
            ...fileListRef.current.filter(
              (file) => !shouldRemoveForTargets(file)
            ),
            ...visibleFiles,
          ]
        : visibleFiles;
      fileListRef.current = nextVisibleFiles;
      const tree = buildFileTree(nextVisibleFiles);
      setFileTree(tree);
      // Keep the old structure for compatibility
      setFileGroups((prev) => {
        const chatStoreSelectedFile = activeTask?.selectedFile;
        if (chatStoreSelectedFile) {
          const file = findMatchingFile(
            nextVisibleFiles,
            chatStoreSelectedFile
          );
          if (file) {
            setIsFileSidebarOpen(true);
            expandFoldersForFile(file as FileInfo);
            if (!isSameFileIdentity(selectedFile, file)) {
              selectedFileChange(file as FileInfo, isShowSourceCode);
            }
          }
        }
        return [
          {
            ...prev[0],
            files: nextVisibleFiles || [],
          },
        ];
      });
      return true;
    };

    const shouldFetch =
      lastFetchKey.current !== fetchKey || !hasFetchedRemote.current;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let inFlightController: AbortController | null = null;
    let inFlightMode: 'full' | 'merge' | null = null;

    const runFileList = (
      targets = projectFetchTargetsRef.current,
      options: { merge?: boolean } = {}
    ) => {
      const mode = options.merge ? 'merge' : 'full';
      if (mode === 'merge' && inFlightMode === 'full') return;
      inFlightController?.abort();
      const controller = new AbortController();
      inFlightController = controller;
      inFlightMode = mode;
      void setFileList({
        targets,
        signal: controller.signal,
        merge: options.merge,
      })
        .then((applied) => {
          if (applied && mode === 'full') {
            hasFetchedRemote.current = true;
          }
        })
        .finally(() => {
          if (inFlightController === controller) {
            inFlightController = null;
            inFlightMode = null;
          }
          if (mode === 'full' && !cancelled) setFilesLoading(false);
        });
    };

    if (shouldFetch) {
      setFilesLoading(true);
      debounceTimer = setTimeout(() => {
        lastFetchKey.current = fetchKey;
        runFileList(projectFetchTargetsRef.current, { merge: false });
      }, 120);
    }

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      inFlightController?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fetchKey,
    projectId,
    fileSpaceId,
    activeTaskId,
    authStore.email,
    authStore.user_id,
    projectFetchKey,
    useBrainWorkspaceFiles,
    useSpaceScopedRemoteFiles,
  ]);

  useEffect(() => {
    hasFetchedRemote.current = false;
  }, [projectId, activeTaskId]);

  const selectedFilePath = activeTask?.selectedFile?.path;

  useEffect(() => {
    const chatStoreSelectedFile = activeTask?.selectedFile;
    if (chatStoreSelectedFile && fileGroups[0]?.files) {
      const file = findMatchingFile(fileGroups[0].files, chatStoreSelectedFile);
      if (file) {
        setIsFileSidebarOpen(true);
        expandFoldersForFile(file as FileInfo);
        if (!isSameFileIdentity(selectedFile, file)) {
          selectedFileChange(file as FileInfo);
        }
      }
    } else if (!chatStoreSelectedFile && selectedFile) {
      setSelectedFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTaskId, fileGroups, selectedFilePath]);

  const fileBreadcrumbSegments = useMemo(() => {
    if (!selectedFile) return [];
    const projectRootLabel = workingFolderPath
      ? workingFolderBasename(workingFolderPath)
      : t('chat.agent-folder');
    return getFileBreadcrumbSegments(selectedFile, {
      projectRootLabel,
      remoteRootLabel: t('folder.file-path-remote-root', {
        defaultValue: 'Remote',
      }),
      useProjectRootForRemote: useBrainWorkspaceFiles,
    });
  }, [selectedFile, useBrainWorkspaceFiles, workingFolderPath, t]);

  const selectedTargetIsRemote = Boolean(
    selectedFile?.isRemote || /^https?:\/\//i.test(selectedFile?.path || '')
  );
  const selectedLocalWorkspaceRoot = isDesktopHost
    ? isLocalWorkspaceSpace(activeSpace)
      ? activeSpace?.rootPath?.trim() || ''
      : !selectedTargetIsRemote
        ? workingFolderPath?.trim() || ''
        : ''
    : '';
  const selectedBrowserTargetUrl =
    !isDesktopHost && /^https?:\/\//i.test(selectedFile?.path || '')
      ? selectedFile?.path || ''
      : '';
  const selectedLocalTargetPath = useMemo(() => {
    if (!isDesktopHost || !selectedFile) return '';
    const selectedPath = selectedFile.path?.trim() || '';
    const isAbsoluteLocalPath = /^(?:\/|\\\\|[a-z]:[\\/])/i.test(selectedPath);
    if (isAbsoluteLocalPath && !/^https?:\/\//i.test(selectedPath)) {
      return selectedPath;
    }

    // Local Space file lists can be fetched through Brain and therefore carry
    // an HTTP preview URL. On desktop, the Space root + relative path remains
    // the authoritative exact node to reveal or pass to an editor.
    const relativeTargetPath = normalizeWorkspaceRelativePath(
      selectedFile.relativePath?.trim() ||
        (!/^https?:\/\//i.test(selectedPath) ? selectedPath : '')
    );
    if (selectedLocalWorkspaceRoot && relativeTargetPath) {
      return resolveWorkspaceFilePath(
        selectedLocalWorkspaceRoot,
        relativeTargetPath
      );
    }

    return '';
  }, [isDesktopHost, selectedFile, selectedLocalWorkspaceRoot]);

  const handleLocalFileAction = useCallback(
    async (action: 'reveal' | 'cursor' | 'vscode') => {
      if (!electronAPI || !selectedLocalTargetPath) return;
      try {
        if (selectedLocalWorkspaceRoot && ipcRenderer?.invoke) {
          await ipcRenderer.invoke('set-local-file-preview-roots', [
            selectedLocalWorkspaceRoot,
          ]);
        }
        const result =
          action === 'reveal'
            ? await electronAPI.revealLocalPath(selectedLocalTargetPath)
            : await electronAPI.openInIDE(selectedLocalTargetPath, action);
        if (!result.success) {
          toast.error(result.error || t('chat.failed-to-open-folder'));
          return;
        }
        if (action === 'cursor' || action === 'vscode') {
          authStore.setPreferredIDE(action);
        }
      } catch (error) {
        console.error('Failed to open selected file target:', error);
        toast.error(t('chat.failed-to-open-folder'));
      }
    },
    [
      authStore,
      electronAPI,
      ipcRenderer,
      selectedLocalTargetPath,
      selectedLocalWorkspaceRoot,
      t,
    ]
  );

  const openInActions = useMemo<FileViewerOpenAction[]>(() => {
    if (!selectedFile) return [];
    if (!isDesktopHost) {
      if (selectedFile.isFolder || !selectedBrowserTargetUrl) return [];
      return [
        {
          id: 'browser',
          label: t('folder.open-in-browser', {
            defaultValue: 'Open in browser',
          }),
          icon: <ExternalLink className="size-4" aria-hidden />,
          onSelect: () =>
            window.open(
              selectedBrowserTargetUrl,
              '_blank',
              'noopener,noreferrer'
            ),
        },
      ];
    }
    if (!selectedLocalTargetPath) return [];

    const platform = electronAPI.getPlatform?.();
    const fileManagerLabel =
      platform === 'darwin'
        ? selectedFile.isFolder
          ? 'Open in Finder'
          : 'Show in Finder'
        : platform === 'win32'
          ? selectedFile.isFolder
            ? 'Open in File Explorer'
            : 'Show in File Explorer'
          : selectedFile.isFolder
            ? 'Open in file manager'
            : 'Show in folder';
    return [
      {
        id: 'file-manager',
        label: fileManagerLabel,
        icon: <FolderOpen className="size-4" aria-hidden />,
        onSelect: () => void handleLocalFileAction('reveal'),
      },
      {
        id: 'cursor',
        label: t('chat.open-in-cursor'),
        icon: <img src={cursorIcon} alt="" className="size-4" aria-hidden />,
        onSelect: () => void handleLocalFileAction('cursor'),
      },
      {
        id: 'vscode',
        label: t('chat.open-in-vscode'),
        icon: <img src={vsCodeIcon} alt="" className="size-4" aria-hidden />,
        onSelect: () => void handleLocalFileAction('vscode'),
      },
    ];
  }, [
    electronAPI,
    handleLocalFileAction,
    isDesktopHost,
    selectedFile,
    selectedBrowserTargetUrl,
    selectedLocalTargetPath,
    t,
  ]);

  const handleOpenExternalFile = async () => {
    try {
      if (!selectedFile) return;
      if (!isDesktopHost && selectedBrowserTargetUrl) {
        window.open(selectedBrowserTargetUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      await handleLocalFileAction('reveal');
    } catch (error) {
      console.error('Failed to open file externally:', error);
      toast.error(t('chat.failed-to-open-folder'));
    }
  };

  if (!chatStore && !activeSpace) {
    return <div>Loading...</div>;
  }

  const hasVisibleTreeItems = Boolean(sidebarFileTree.children?.length);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden">
      <FileViewerPanel
        selectedFile={selectedFile}
        loading={loading}
        isShowSourceCode={isShowSourceCode}
        breadcrumbSegments={fileBreadcrumbSegments}
        projectFiles={fileGroups[0]?.files || []}
        surfaceClassName="bg-ds-neutral-subtle-default"
        embedded
        openInActions={openInActions}
        isFileTreeOpen={isFileSidebarOpen}
        onToggleFileTree={() => setIsFileSidebarOpen((open) => !open)}
        fileTreeControlsId={fileTreeControlsId}
        emptyState={
          filesLoading && hasNoFiles ? (
            <div className="flex h-full min-h-64 w-full flex-1 flex-col gap-3 p-4">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-[82%]" />
              <Skeleton className="h-3 w-[68%]" />
            </div>
          ) : undefined
        }
        onRevealFile={() => {
          if (!selectedFile) return;
          if (isDesktopHost && selectedLocalTargetPath) {
            void handleLocalFileAction('reveal');
            return;
          }
          if (selectedTargetIsRemote) {
            if (!selectedFile.isFolder) {
              void downloadOpenedFile(selectedFile);
            }
            return;
          }
        }}
        onOpenExternalFile={() => void handleOpenExternalFile()}
        onDownloadFile={() => {
          if (!selectedFile || selectedFile.isFolder) return;
          if (selectedFile.preview?.kind === 'blocked') {
            if (selectedFile.isRemote) {
              window.open(selectedFile.path, '_blank', 'noopener,noreferrer');
            }
            return;
          }
          void downloadOpenedFile(selectedFile);
        }}
        onToggleSourceCode={isShowSourceCodeChange}
      />

      {isFileSidebarOpen ? (
        <aside
          data-file-tree-rail
          className={cn(
            'flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-y-0 border-r-0 border-l border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default',
            RIGHT_RAIL_CONTENT_WIDTH_CLASS
          )}
          style={{ maxWidth: '50%' }}
          aria-label={t('chat.files')}
        >
          <div
            data-file-tree-header
            className="flex h-ds-layout-row-header min-h-ds-layout-row-header shrink-0 items-center gap-2 px-2"
          >
            <span className="min-w-0 flex-1 truncate px-1 text-ds-text-base font-semibold text-ds-ink-default-default">
              {t('chat.files')}
            </span>
          </div>

          <div id={fileTreeControlsId} className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-1.5 px-2 pb-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ds-ink-muted-default" />
                <input
                  type="search"
                  value={fileSearchQuery}
                  onChange={(event) => setFileSearchQuery(event.target.value)}
                  placeholder={t('chat.search')}
                  className="h-8 w-full rounded-lg border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default py-0 pr-2 pl-7 text-ds-text-base text-ds-ink-default-default outline-none placeholder:text-ds-ink-muted-default focus:ring-2 focus:ring-ds-ring-focus"
                  aria-label={t('folder.search-files', {
                    defaultValue: 'Search files',
                  })}
                />
              </div>
            </div>

            <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {filesLoading && hasNoFiles ? (
                <div
                  role="status"
                  aria-label={t('folder.loading-files', {
                    defaultValue: 'Loading files',
                  })}
                  className="space-y-3 px-2 py-3"
                >
                  {Array.from({ length: 7 }, (_, index) => (
                    <Skeleton
                      key={index}
                      className={cn(
                        'h-3',
                        index % 3 === 0 ? 'w-40' : 'ml-4 w-32'
                      )}
                    />
                  ))}
                </div>
              ) : hasVisibleTreeItems ? (
                <FileTree
                  node={sidebarFileTree}
                  selectedFile={selectedFile}
                  expandedFolders={visibleExpandedFolders}
                  onToggleFolder={toggleFolder}
                  onSelectFile={selectedFileChange}
                  isShowSourceCode={isShowSourceCode}
                />
              ) : (
                <div className="flex min-h-48 flex-col items-center justify-center gap-2 px-4 text-center text-ds-text-base text-ds-ink-muted-default">
                  <FileText className="size-7" aria-hidden />
                  <p className="m-0">
                    {fileSearchQuery.trim()
                      ? t('folder.no-search-results', {
                          defaultValue: 'No files match your search.',
                        })
                      : t('folder.no-files', {
                          defaultValue: 'No files yet.',
                        })}
                  </p>
                </div>
              )}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function ImageLoader({ selectedFile }: { selectedFile: FileInfo }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSrc('');
    if (selectedFile.isRemote) {
      const contentSrc = selectedFile.content as string | undefined;
      if (contentSrc) {
        setSrc(contentSrc);
        return;
      }

      void fetchRemoteFileAsDataUrl(selectedFile.path)
        .then((dataUrl) => {
          if (!cancelled) setSrc(dataUrl);
        })
        .catch((error) => {
          console.warn(
            '[ImageLoader] Failed to fetch remote image as data URL, falling back to direct URL:',
            selectedFile.path,
            error
          );
          if (!cancelled) setSrc(selectedFile.path);
        });
      return () => {
        cancelled = true;
      };
    }
    // The privileged protocol streams workspace-scoped files without exposing
    // a raw file:// URL, which Chromium blocks from the renderer origin.
    setSrc(
      (selectedFile.content as string | undefined) ||
        toLocalPreviewUrl(selectedFile.path)
    );
    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={selectedFile.name}
      className="max-h-full max-w-full object-contain"
      onError={(err) => console.error('Image load error:', err)}
    />
  );
}

function AudioLoader({ selectedFile }: { selectedFile: FileInfo }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState('');

  useEffect(() => {
    setSrc('');
    if (selectedFile.isRemote) {
      setSrc(selectedFile.content || selectedFile.path);
      return;
    }
    setSrc(
      (selectedFile.content as string | undefined) ||
        toLocalPreviewUrl(selectedFile.path)
    );
  }, [selectedFile]);

  return (
    <div className="flex w-full flex-col items-center gap-4 px-8">
      <p className="text-sm font-medium text-ds-ink-default-default">
        {selectedFile.name}
      </p>
      <audio
        controls
        src={src}
        className="w-full"
        onError={(err) => console.error('Audio load error:', err)}
      >
        {t('folder.audio-playback-unsupported', {
          defaultValue: 'Your browser does not support audio playback.',
        })}
      </audio>
    </div>
  );
}

function VideoLoader({ selectedFile }: { selectedFile: FileInfo }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState('');

  useEffect(() => {
    setSrc('');
    if (selectedFile.isRemote) {
      setSrc(selectedFile.content || selectedFile.path);
      return;
    }
    setSrc(
      (selectedFile.content as string | undefined) ||
        toLocalPreviewUrl(selectedFile.path)
    );
  }, [selectedFile]);

  return (
    <video
      controls
      src={src}
      className="max-h-full max-w-full object-contain"
      onError={(err) => console.error('Video load error:', err)}
    >
      {t('folder.video-playback-unsupported', {
        defaultValue: 'Your browser does not support video playback.',
      })}
    </video>
  );
}

// Helper function to get directory path from file path
function getDirPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : '';
}

// Helper function to join paths
function joinPath(...paths: string[]): string {
  return paths
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/');
}

/** Join a renderer-known workspace root without losing Windows/UNC prefixes. */
export function joinWorkspacePath(
  workspaceRoot: string,
  relativePath: string
): string {
  const separator = workspaceRoot.includes('\\') ? '\\' : '/';
  const root = workspaceRoot.replace(/[\\/]+$/, '');
  const relative = relativePath
    .replace(/^[\\/]+/, '')
    .split(/[\\/]+/)
    .filter(Boolean)
    .join(separator);
  return relative ? `${root}${separator}${relative}` : root;
}

// Helper function to resolve relative paths (handles ../ and ./)
function resolveRelativePath(basePath: string, relativePath: string): string {
  // Normalize paths
  const normalizedBase = basePath.replace(/\\/g, '/');
  const normalizedRelative = relativePath.replace(/\\/g, '/');

  // If it's not a relative path, return as-is
  if (
    !normalizedRelative.startsWith('./') &&
    !normalizedRelative.startsWith('../')
  ) {
    // It's a simple relative path like "script.js" or "js/script.js"
    return joinPath(normalizedBase, normalizedRelative);
  }

  const baseParts = normalizedBase.split('/').filter(Boolean);
  const relativeParts = normalizedRelative.split('/').filter(Boolean);

  for (const part of relativeParts) {
    if (part === '.') {
      // Current directory, skip
      continue;
    } else if (part === '..') {
      // Parent directory, go up one level
      baseParts.pop();
    } else {
      // Regular path segment
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

function getUrlBasename(url: string): string {
  const pathWithoutQuery = url.split(/[?#]/, 1)[0] ?? '';
  return pathWithoutQuery.replace(/\\/g, '/').split('/').pop() ?? '';
}

function inlineExternalScriptByName(
  html: string,
  fileName: string,
  jsContent: string
): string {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  let replaced = false;

  doc.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src') ?? '';
    if (getUrlBasename(src) !== fileName) {
      return;
    }

    script.removeAttribute('src');
    script.setAttribute('data-source', fileName);
    script.textContent = jsContent;
    replaced = true;
  });

  return replaced
    ? `${doctype}${doc.documentElement?.outerHTML || html}`
    : html;
}

function collectReferencedAssetPaths(
  html: string,
  htmlDir: string
): Set<string> {
  const referencedPaths: Set<string> = new Set();
  const template = document.createElement('template');
  template.innerHTML = html;

  const addReferencedPath = (url: string) => {
    if (
      !url.startsWith('http://') &&
      !url.startsWith('https://') &&
      !url.startsWith('//')
    ) {
      const resolvedPath = resolveRelativePath(htmlDir, url);
      referencedPaths.add(resolvedPath.toLowerCase());
    }
  };

  template.content.querySelectorAll('script[src]').forEach((script) => {
    const src = script.getAttribute('src');
    if (src) {
      addReferencedPath(src);
    }
  });

  template.content.querySelectorAll('link[href]').forEach((link) => {
    const href = link.getAttribute('href');
    const hrefPath = href?.split(/[?#]/, 1)[0].toLowerCase();
    if (href && hrefPath?.endsWith('.css')) {
      addReferencedPath(href);
    }
  });

  return referencedPaths;
}

function normalizeLookupPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .toLowerCase();
}

function getRelativeDirPath(
  relativePath?: string,
  fallbackName?: string
): string {
  const target = (relativePath || fallbackName || '').replace(/\\/g, '/');
  const lastSlashIndex = target.lastIndexOf('/');
  return lastSlashIndex >= 0 ? target.substring(0, lastSlashIndex) : '';
}

function isSpecialBrowserUrl(url: string): boolean {
  const normalizedUrl = url.trim().toLowerCase();
  return (
    !normalizedUrl ||
    normalizedUrl.startsWith('http://') ||
    normalizedUrl.startsWith('https://') ||
    normalizedUrl.startsWith('//') ||
    normalizedUrl.startsWith('data:') ||
    normalizedUrl.startsWith('blob:') ||
    normalizedUrl.startsWith('mailto:') ||
    normalizedUrl.startsWith('tel:') ||
    normalizedUrl.startsWith('javascript:') ||
    normalizedUrl.startsWith('vbscript:') ||
    normalizedUrl.startsWith('#')
  );
}

function isInlineImageUrl(url: string): boolean {
  const normalizedUrl = url.trim().toLowerCase();
  return normalizedUrl.startsWith('data:') || normalizedUrl.startsWith('blob:');
}

function getPathWithoutSearchOrHash(pathOrUrl: string): string {
  return pathOrUrl.split(/[?#]/)[0].toLowerCase();
}

function isImagePathLike(pathOrUrl: string): boolean {
  const path = getPathWithoutSearchOrHash(pathOrUrl);
  return IMAGE_EXTENSIONS.some((ext) => path.endsWith(`.${ext}`));
}

function isRemoteProjectFileUrl(url: string, baseHref?: string): boolean {
  try {
    const parsedUrl = new URL(url, baseHref || window.location.href);
    return (
      parsedUrl.pathname.includes('/files/stream') ||
      parsedUrl.pathname.includes('/files/preview/')
    );
  } catch {
    return false;
  }
}

function toAbsoluteResourceUrl(url: string, baseHref?: string): string | null {
  try {
    return new URL(url, baseHref || window.location.href).toString();
  } catch {
    return null;
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function fetchRemoteFileAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return readBlobAsDataUrl(await response.blob());
}

function shouldInlineHtmlImageUrl(url: string, baseHref?: string): boolean {
  if (!url || isInlineImageUrl(url)) {
    return false;
  }

  const absoluteUrl = toAbsoluteResourceUrl(url, baseHref);
  if (!absoluteUrl) {
    return false;
  }

  return isRemoteProjectFileUrl(absoluteUrl) || isImagePathLike(url);
}

async function inlineImageUrl(
  url: string,
  baseHref?: string
): Promise<string | null> {
  if (!shouldInlineHtmlImageUrl(url, baseHref)) {
    return null;
  }

  const absoluteUrl = toAbsoluteResourceUrl(url, baseHref);
  if (!absoluteUrl) {
    return null;
  }

  try {
    return await fetchRemoteFileAsDataUrl(absoluteUrl);
  } catch (error) {
    console.warn('[HtmlRenderer] Failed to inline image:', absoluteUrl, error);
    return null;
  }
}

async function inlineSrcsetImages(
  srcset: string,
  baseHref?: string
): Promise<string> {
  if (srcset.toLowerCase().includes('data:')) {
    return srcset;
  }

  const candidates = srcset
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (!candidates.length) {
    return srcset;
  }

  const rewrittenCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      const [url, ...descriptors] = candidate.split(/\s+/);
      const dataUrl = await inlineImageUrl(url, baseHref);
      return [dataUrl || url, ...descriptors].join(' ');
    })
  );

  return rewrittenCandidates.join(', ');
}

async function inlineCssImageUrls(
  cssText: string,
  baseHref?: string
): Promise<string> {
  const matches = Array.from(
    cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)
  );
  if (!matches.length) {
    return cssText;
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const fullMatch = match[0];
      const url = match[2];
      const dataUrl = await inlineImageUrl(url, baseHref);
      return dataUrl ? { fullMatch, replacement: `url("${dataUrl}")` } : null;
    })
  );

  return replacements.reduce((result, replacement) => {
    if (!replacement) return result;
    return result.replace(replacement.fullMatch, replacement.replacement);
  }, cssText);
}

function injectSandboxStorageShim(html: string): string {
  if (!html || html.includes('data-eigent-sandbox-storage-shim')) {
    return html;
  }

  const shim = `<script data-eigent-sandbox-storage-shim>
(function () {
  function createMemoryStorage() {
    var values = Object.create(null);
    return {
      get length() { return Object.keys(values).length; },
      key: function (index) { return Object.keys(values)[index] || null; },
      getItem: function (key) {
        key = String(key);
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
      setItem: function (key, value) { values[String(key)] = String(value); },
      removeItem: function (key) { delete values[String(key)]; },
      clear: function () { values = Object.create(null); }
    };
  }
  function install(name) {
    try {
      void window[name];
      return;
    } catch {
      // Access throws in opaque-origin sandboxed iframes.
    }
    try {
      Object.defineProperty(window, name, {
        value: createMemoryStorage(),
        configurable: true
      });
    } catch {
      // If the browser refuses replacement, keep the original sandbox error.
    }
  }
  install('localStorage');
  install('sessionStorage');
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${shim}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1<head>${shim}</head>`);
  }
  return `${shim}${html}`;
}

async function inlineRemoteHtmlImages(
  html: string,
  baseHref?: string
): Promise<string> {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';

  await Promise.all(
    Array.from(doc.querySelectorAll('[src], [href], [srcset]')).map(
      async (element) => {
        const src = element.getAttribute('src');
        if (src) {
          const dataUrl = await inlineImageUrl(src, baseHref);
          if (dataUrl) {
            element.setAttribute('src', dataUrl);
          }
        }

        const href = element.getAttribute('href');
        if (href && element.tagName.toLowerCase() === 'image') {
          const dataUrl = await inlineImageUrl(href, baseHref);
          if (dataUrl) {
            element.setAttribute('href', dataUrl);
          }
        }

        const srcset = element.getAttribute('srcset');
        if (srcset) {
          element.setAttribute(
            'srcset',
            await inlineSrcsetImages(srcset, baseHref)
          );
        }
      }
    )
  );

  await Promise.all(
    Array.from(doc.querySelectorAll('[style]')).map(async (element) => {
      const style = element.getAttribute('style');
      if (style) {
        element.setAttribute(
          'style',
          await inlineCssImageUrls(style, baseHref)
        );
      }
    })
  );

  await Promise.all(
    Array.from(doc.querySelectorAll('style')).map(async (styleElement) => {
      styleElement.textContent = await inlineCssImageUrls(
        styleElement.textContent || '',
        baseHref
      );
    })
  );

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

function getRemoteRelativePath(file: FileInfo): string | undefined {
  if (file.relativePath) {
    return file.relativePath.replace(/\\/g, '/');
  }

  if (!file.path) return undefined;

  try {
    const url = new URL(file.path, window.location.origin);
    const pathParam = url.searchParams.get('path');
    return pathParam
      ? decodeURIComponent(pathParam).replace(/\\/g, '/')
      : undefined;
  } catch {
    return undefined;
  }
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function getRemotePreviewUrl(file: FileInfo): string | undefined {
  const relativePath = getRemoteRelativePath(file);
  if (!relativePath || !file.path) {
    return undefined;
  }

  try {
    const url = new URL(file.path, window.location.origin);
    const email = url.searchParams.get('email');
    const projectId = url.searchParams.get('project_id');
    const spaceId = url.searchParams.get('space_id');
    const userId = url.searchParams.get('user_id');
    if (!email || !projectId) {
      return undefined;
    }

    const filesIndex = url.pathname.indexOf('/files/stream');
    const routePrefix =
      filesIndex >= 0 ? url.pathname.substring(0, filesIndex) : '';

    const query = new URLSearchParams();
    if (spaceId) query.set('space_id', spaceId);
    if (userId) query.set('user_id', userId);
    const queryString = query.toString();
    return `${url.origin}${routePrefix}/files/preview/${encodeURIComponent(email)}/${encodeURIComponent(projectId)}/${encodePathSegments(relativePath)}${queryString ? `?${queryString}` : ''}`;
  } catch {
    return undefined;
  }
}

function getRemotePreviewBaseHref(file: FileInfo): string | undefined {
  const previewUrl = getRemotePreviewUrl(file);
  if (!previewUrl) {
    return undefined;
  }

  const lastSlashIndex = previewUrl.lastIndexOf('/');
  return lastSlashIndex >= 0
    ? `${previewUrl.substring(0, lastSlashIndex + 1)}`
    : previewUrl;
}

function injectBaseHref(html: string, baseHref: string): string {
  if (!baseHref || typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  const base = doc.querySelector('base') || doc.createElement('base');

  base.setAttribute('href', baseHref);

  if (!base.parentElement) {
    const head = doc.head || doc.createElement('head');
    head.prepend(base);
    if (!doc.head) {
      const htmlElement = doc.documentElement || doc.createElement('html');
      htmlElement.prepend(head);
      if (!doc.documentElement) {
        doc.appendChild(htmlElement);
      }
    }
  }

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

function rewriteRemoteHtmlReferences(
  html: string,
  selectedFile: FileInfo,
  projectFiles: FileInfo[]
): string {
  const htmlRelativePath = getRemoteRelativePath(selectedFile);
  if (!htmlRelativePath || typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const baseDir = getRelativeDirPath(htmlRelativePath, selectedFile.name);
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  const fileMap = new Map<string, FileInfo>();

  projectFiles.forEach((file) => {
    if (!file.relativePath) return;
    fileMap.set(normalizeLookupPath(file.relativePath), file);
  });

  const rewriteAttribute = (element: Element, attributeName: string) => {
    const originalValue = element.getAttribute(attributeName);
    if (!originalValue || isSpecialBrowserUrl(originalValue)) return;

    const match = originalValue.match(/^([^?#]*)(.*)$/);
    const pathPart = match?.[1] || originalValue;
    const suffix = match?.[2] || '';
    const resolvedRelativePath = pathPart.startsWith('/')
      ? pathPart.replace(/^\/+/, '')
      : resolveRelativePath(baseDir, pathPart);
    const matchedFile = fileMap.get(normalizeLookupPath(resolvedRelativePath));

    if (matchedFile?.path) {
      element.setAttribute(attributeName, `${matchedFile.path}${suffix}`);
    }
  };

  doc
    .querySelectorAll('[src], [href], [poster], [data], [action]')
    .forEach((element) => {
      ['src', 'href', 'poster', 'data', 'action'].forEach((attributeName) => {
        if (element.hasAttribute(attributeName)) {
          rewriteAttribute(element, attributeName);
        }
      });
    });

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

// Component to render HTML with relative image paths resolved
function HtmlRenderer({
  selectedFile,
  projectFiles,
}: {
  selectedFile: FileInfo;
  projectFiles: FileInfo[];
}) {
  const { t } = useTranslation();
  const [processedHtml, setProcessedHtml] = useState<string>('');
  const [authorizedRemotePreviewPath, setAuthorizedRemotePreviewPath] =
    useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const electronAPI = host?.electronAPI;
  const remoteOrigins = useMemo(
    () => collectPreviewRemoteOrigins(selectedFile.content || ''),
    [selectedFile.content]
  );
  const remoteContentAllowed =
    authorizedRemotePreviewPath === selectedFile.path;

  useEffect(() => {
    const processHtml = async () => {
      if (!selectedFile.content) {
        setProcessedHtml('');
        return;
      }
      if (remoteOrigins.length && !remoteContentAllowed) {
        setProcessedHtml('');
        return;
      }

      let html = repairGeneratedReportBraces(selectedFile.content);

      // Get the directory of the HTML file
      const htmlDir = getDirPath(selectedFile.path);

      const referencedPaths = collectReferencedAssetPaths(html, htmlDir);

      // Find matching files (exact path match only)
      const relatedFiles = projectFiles.filter((file) => {
        if (
          file.isFolder ||
          !['js', 'css'].includes(file.type?.toLowerCase() || '')
        )
          return false;
        const normalizedFilePath = file.path.replace(/\\/g, '/').toLowerCase();
        return referencedPaths.has(normalizedFilePath);
      });

      const jsFiles = relatedFiles.filter(
        (f) => f.type?.toLowerCase() === 'js'
      );
      const cssFiles = relatedFiles.filter(
        (f) => f.type?.toLowerCase() === 'css'
      );

      // Check for dangerous Electron/Node.js patterns as defense-in-depth
      if (containsDangerousContent(html)) {
        setProcessedHtml('');
        return;
      }

      // Remote HTML needs URL rewriting so relative assets resolve back to Brain.
      if (selectedFile.isRemote) {
        const previewBaseHref = getRemotePreviewBaseHref(selectedFile);
        const rewrittenHtml = rewriteRemoteHtmlReferences(
          html,
          selectedFile,
          projectFiles
        );
        const htmlWithBaseHref = previewBaseHref
          ? injectBaseHref(rewrittenHtml, previewBaseHref)
          : rewrittenHtml;
        const htmlWithInlineImages = await inlineRemoteHtmlImages(
          htmlWithBaseHref,
          previewBaseHref
        );
        const htmlWithStorageShim =
          injectSandboxStorageShim(htmlWithInlineImages);
        const htmlWithPreviewFonts = remoteContentAllowed
          ? deferInlineScriptsUntilLoad(htmlWithStorageShim)
          : injectFontStyles(deferInlineScriptsUntilLoad(htmlWithStorageShim));
        setProcessedHtml(
          injectPreviewContentSecurityPolicy(
            htmlWithPreviewFonts,
            remoteOrigins
          )
        );
        return;
      }

      let processedHtmlContent = html;
      if (electronAPI?.readFileAsDataUrl) {
        processedHtmlContent = await inlineLocalHtmlImgElements(
          processedHtmlContent,
          htmlDir,
          electronAPI.readFileAsDataUrl
        );
      }

      if (ipcRenderer) {
        processedHtmlContent = await inlineLocalHtmlScriptElements(
          processedHtmlContent,
          htmlDir,
          (filePath) => ipcRenderer.invoke('open-file', 'js', filePath, false)
        );
      }

      // Load and inject CSS files, replacing external link tags
      for (const cssFile of cssFiles) {
        try {
          const cssContent = ipcRenderer
            ? await ipcRenderer.invoke('open-file', 'css', cssFile.path, false)
            : null;
          if (cssContent) {
            const styleTag = `<style data-source="${cssFile.name}">${cssContent}</style>`;

            // Try to replace the external link tag with inline style
            const linkRegex = new RegExp(
              `<link[^>]*href=["'](?:[^"']*[/\\\\])?${cssFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
              'gi'
            );
            const replacedCss = processedHtmlContent.replace(
              linkRegex,
              styleTag
            );
            if (replacedCss !== processedHtmlContent) {
              processedHtmlContent = replacedCss;
            } else {
              // Fallback: inject CSS at the beginning of the HTML
              if (processedHtmlContent.includes('<head>')) {
                processedHtmlContent = processedHtmlContent.replace(
                  '<head>',
                  `<head>${styleTag}`
                );
              } else {
                processedHtmlContent = styleTag + processedHtmlContent;
              }
            }
          }
        } catch (error) {
          console.error(`Failed to load CSS file: ${cssFile.path}`, error);
        }
      }

      // Load JS files content and replace external script tags
      for (const jsFile of jsFiles) {
        try {
          const jsContent = ipcRenderer
            ? await ipcRenderer.invoke('open-file', 'js', jsFile.path, false)
            : null;
          if (jsContent) {
            processedHtmlContent = inlineExternalScriptByName(
              processedHtmlContent,
              jsFile.name,
              jsContent
            );
          }
        } catch (error) {
          console.error(`Failed to load JS file: ${jsFile.path}`, error);
        }
      }

      if (electronAPI?.readFileAsDataUrl) {
        processedHtmlContent = await inlineLocalProjectImagePaths(
          processedHtmlContent,
          htmlDir,
          projectFiles,
          electronAPI.readFileAsDataUrl
        );
      }

      processedHtmlContent = injectBaseHref(
        processedHtmlContent,
        toLocalFileUrl(htmlDir)
      );

      // Final check for dangerous content after all processing (including injected JS)
      if (containsDangerousContent(processedHtmlContent)) {
        setProcessedHtml('');
        return;
      }

      // Defer inline scripts until load when document has external scripts (e.g. Chart.js),
      const htmlWithDeferredScripts = deferInlineScriptsUntilLoad(
        injectSandboxStorageShim(processedHtmlContent)
      );
      const htmlWithPreviewFonts = remoteContentAllowed
        ? htmlWithDeferredScripts
        : injectFontStyles(htmlWithDeferredScripts);

      // Authorized remote reports retain their declared fonts; offline reports
      // keep Eigent's deterministic system-font fallback.
      setProcessedHtml(
        injectPreviewContentSecurityPolicy(htmlWithPreviewFonts, remoteOrigins)
      );
    };

    processHtml().catch((error) => {
      console.error('[HtmlRenderer] Failed to process HTML:', error);
      const fallbackHtml = remoteContentAllowed
        ? selectedFile.content || ''
        : injectFontStyles(selectedFile.content || '');
      setProcessedHtml(
        injectPreviewContentSecurityPolicy(
          fallbackHtml,
          remoteContentAllowed ? remoteOrigins : []
        )
      );
    });
  }, [
    selectedFile,
    projectFiles,
    ipcRenderer,
    electronAPI,
    remoteContentAllowed,
    remoteOrigins,
  ]);

  // Zoom state and controls
  const [zoom, setZoom] = useState(100);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 10, 200));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 10, 50));
  const handleZoomReset = () => setZoom(100);

  // Handle scroll wheel zoom (Ctrl+scroll or pinch)
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setZoom((prev) => Math.min(Math.max(prev + delta, 50), 200));
    }
  };

  if (remoteOrigins.length && !remoteContentAllowed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-ds-neutral-strong-default p-6">
        <div className="w-full max-w-[36rem] rounded-2xl border border-x border-y border-ds-hairline-subtle-default bg-ds-neutral-subtle-default p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-ds-icon-warning-default-default"
              aria-hidden
            />
            <div className="min-w-0">
              <h3 className="!text-ds-text-body-large font-bold">
                {t('folder.html-external-content-title', {
                  defaultValue: 'This HTML uses external content',
                })}
              </h3>
              <p className="mt-1 text-ds-text-base text-ds-ink-muted-default">
                {t('folder.html-external-content-description', {
                  defaultValue:
                    "Loading it gives remote code access to this report's rendered content. Access applies only to this preview session.",
                })}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {remoteOrigins.map((origin) => (
                  <code
                    key={origin}
                    className="rounded-md bg-ds-neutral-default-default px-2 py-1 text-ds-text-meta"
                  >
                    {origin}
                  </code>
                ))}
              </div>
              <Button
                type="button"
                className="mt-4"
                onClick={() =>
                  setAuthorizedRemotePreviewPath(selectedFile.path)
                }
              >
                {t('folder.load-external-content', {
                  defaultValue: 'Load external content',
                })}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selectedFile.content && !processedHtml) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      {/* Floating notch-style zoom controls */}
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
      />

      {/* Content area with zoom */}
      <div
        className="min-h-0 flex-1 overflow-hidden bg-ds-neutral-strong-default"
        onWheel={handleWheel}
      >
        <div
          className="h-full origin-top-left transition-transform duration-150 motion-reduce:transition-none"
          style={{
            transform: `scale(${zoom / 100})`,
            width: `${10000 / zoom}%`,
            height: `${10000 / zoom}%`,
          }}
        >
          {/*Security is maintained via CSP allowlist in index.html which restricts script sources. */}
          <iframe
            ref={iframeRef}
            srcDoc={processedHtml}
            className="h-full w-full border-0 border-x-0 border-y-0 bg-white"
            sandbox="allow-scripts allow-forms allow-downloads"
            title={selectedFile.name}
            tabIndex={0}
            onLoad={() => iframeRef.current?.focus()}
          />
        </div>
      </div>
    </div>
  );
}

export interface FileViewerPanelProps {
  /** File whose content is shown, or null for the empty placeholder. */
  selectedFile: FileInfo | null;
  /** Whether content is currently being fetched. */
  loading: boolean;
  /** Render raw source instead of the rich view (md/html). */
  isShowSourceCode: boolean;
  /** Breadcrumb labels for the file path header. */
  breadcrumbSegments: string[];
  /** Sibling project files, used by the HTML renderer to resolve local assets. */
  projectFiles: FileInfo[];
  /** Outer surface background class. */
  surfaceClassName?: string;
  /** Remove standalone spacing/radius when rendered inside another panel shell. */
  embedded?: boolean;
  /** Clicking the breadcrumb (reveal in folder / download remote). Ignored when
   * {@link onBreadcrumbSegmentClick} is provided (segments become individually
   * clickable instead). */
  onRevealFile: () => void;
  /** When set, breadcrumb segments are individually clickable (e.g. a "Context"
   * root that navigates elsewhere). Receives the clicked segment index. */
  onBreadcrumbSegmentClick?: (index: number) => void;
  /** Remote fallback used only inside the blocked-preview empty state. */
  onDownloadFile: () => void;
  /** Open an oversized or unsupported file with the host system. */
  onOpenExternalFile?: () => void;
  /** Exact selected-node destinations shown in the Open in menu. */
  openInActions?: FileViewerOpenAction[];
  /** Toggle the source-code view. */
  onToggleSourceCode: () => void;
  /** Whether the shared right-side file tree is currently visible. */
  isFileTreeOpen?: boolean;
  /** Toggle the shared right-side file tree from the content toolbar. */
  onToggleFileTree?: () => void;
  /** Unique id of the controlled file-tree region. */
  fileTreeControlsId?: string;
  /** Extra controls rendered at the end of the header row (e.g. a close button). */
  headerActionsExtra?: React.ReactNode;
  /** Replaces the default placeholder shown when no file is selected. */
  emptyState?: React.ReactNode;
}

function TruncatedPreviewNotice({ file }: { file: FileInfo }) {
  const { t } = useTranslation();
  if (file.preview?.kind !== 'truncated-text') return null;
  return (
    <div className="mb-2 rounded-lg bg-ds-neutral-subtle-default px-3 py-2 text-ds-text-meta text-ds-ink-muted-default">
      {t('folder.truncated-preview-summary', {
        bytesRead: formatFileSize(file.preview.bytesRead),
        totalBytes:
          file.preview.totalBytes !== null
            ? t('folder.preview-total-size', {
                size: formatFileSize(file.preview.totalBytes),
                defaultValue: ' of {{size}}',
              })
            : '',
        defaultValue:
          'Previewing {{bytesRead}}{{totalBytes}}. The complete file was not loaded.',
      })}
    </div>
  );
}

function SourceFilePreview({
  file,
  appearance,
}: {
  file: FileInfo;
  appearance: string;
}) {
  const { t } = useTranslation();
  const sourcePath = file.relativePath || file.path || file.name;
  return (
    <div className="flex h-full min-h-0 w-full flex-col p-2">
      <TruncatedPreviewNotice file={file} />
      <div className="min-h-0 flex-1 overflow-hidden rounded-[6px] border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default">
        <SourceCodeViewer
          value={file.content || ''}
          path={sourcePath}
          appearance={appearance}
          ariaLabel={t('folder.source-for-file', {
            name: file.name,
            defaultValue: 'Source for {{name}}',
          })}
        />
      </div>
    </div>
  );
}

function BlockedPreviewPlaceholder({
  file,
  onRevealFile,
  onDownloadFile,
}: {
  file: FileInfo;
  onRevealFile: () => void;
  onDownloadFile: () => void;
}) {
  const { t } = useTranslation();
  if (file.preview?.kind !== 'blocked') return null;
  const reason =
    file.preview.reason === 'too-large'
      ? t('folder.preview-too-large', {
          defaultValue: 'This file exceeds the safe in-app preview limit.',
        })
      : file.preview.reason === 'metadata-unavailable'
        ? t('folder.preview-metadata-unavailable', {
            defaultValue:
              'Eigent could not verify the file size, so automatic preview was blocked.',
          })
        : t('folder.preview-type-unsupported', {
            defaultValue:
              'This file type cannot be safely previewed in this environment.',
          });
  return (
    <div className="flex h-full min-h-64 w-full items-center justify-center px-6 py-10">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <AlertTriangle className="size-10 text-ds-ink-muted-default" />
        <div>
          <p className="m-0 text-ds-text-body-large font-semibold text-ds-ink-default-default">
            {t('folder.preview-not-loaded', {
              defaultValue: 'Preview not loaded',
            })}
          </p>
          <p className="mt-1 text-ds-text-base text-ds-ink-muted-default">
            {reason}
          </p>
        </div>
        <div className="text-ds-text-meta text-ds-ink-muted-default">
          {t('folder.preview-file-size', {
            size: formatFileSize(file.preview.size),
            limit:
              file.preview.limit !== null
                ? t('folder.preview-limit', {
                    size: formatFileSize(file.preview.limit),
                    defaultValue: ' · Preview limit: {{size}}',
                  })
                : '',
            defaultValue: 'File size: {{size}}{{limit}}',
          })}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" variant="secondary" onClick={onRevealFile}>
            {t('folder.open-externally', {
              defaultValue: 'Open externally',
            })}
          </Button>
          {file.isRemote ? (
            <Button type="button" variant="ghost" onClick={onDownloadFile}>
              {t('folder.download', { defaultValue: 'Download' })}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Presentational file viewer: breadcrumb header + type-aware content body.
 * Shared by the Files tab and the inline project-page preview so both
 * render markdown/PDF/docs/HTML/media identically. All data and callbacks are
 * supplied by the parent — this component owns no loading state.
 */
export function FileViewerPanel({
  selectedFile,
  loading,
  isShowSourceCode,
  breadcrumbSegments,
  projectFiles,
  surfaceClassName = 'bg-ds-neutral-subtle-default',
  embedded = false,
  onRevealFile,
  onBreadcrumbSegmentClick,
  onDownloadFile,
  onOpenExternalFile,
  openInActions = [],
  onToggleSourceCode,
  isFileTreeOpen,
  onToggleFileTree,
  fileTreeControlsId,
  headerActionsExtra,
  emptyState,
}: FileViewerPanelProps) {
  const { t } = useTranslation();
  const appearance = useAuthStore((state) => state.appearance);
  const segmentsClickable = Boolean(onBreadcrumbSegmentClick);
  const selectedType = selectedFile ? getFileType(selectedFile) : '';
  const supportsRichView =
    Boolean(selectedFile) &&
    ['md', 'markdown', 'html', 'htm'].includes(selectedType) &&
    selectedFile?.preview?.kind !== 'truncated-text' &&
    selectedFile?.preview?.kind !== 'blocked';
  const previewViewLabel = t('folder.preview-view', {
    defaultValue: 'Preview',
  });
  const sourceViewLabel = t('folder.source-view', {
    defaultValue: 'Source',
  });
  const showsHtmlPreview =
    Boolean(selectedFile) &&
    ['html', 'htm'].includes(selectedType) &&
    !isShowSourceCode &&
    selectedFile?.preview?.kind !== 'truncated-text';
  const showsCodeSource =
    Boolean(selectedFile) &&
    !loading &&
    !selectedFile?.isFolder &&
    selectedFile?.preview?.kind !== 'blocked' &&
    selectedFile?.preview?.kind !== 'csv' &&
    selectedType !== 'pdf' &&
    !['doc', 'docx', 'pptx', 'xlsx'].includes(selectedType) &&
    selectedType !== 'zip' &&
    !isAudioFile(selectedFile!) &&
    !isVideoFile(selectedFile!) &&
    !isImageFile(selectedFile!) &&
    !(['md', 'markdown'].includes(selectedType) && !isShowSourceCode) &&
    !showsHtmlPreview;
  return (
    <div
      className={`${
        embedded ? 'min-w-0' : 'mb-sm min-w-0 rounded-xl'
      } flex min-h-0 flex-1 flex-col overflow-hidden ${surfaceClassName}`}
    >
      {/* head */}
      {(selectedFile || onToggleFileTree) && (
        <div className="flex min-h-ds-layout-row-header shrink-0 flex-wrap items-center justify-between gap-2 border-y-0 border-r-0 border-l-0 border-solid border-ds-hairline-subtle-default pr-2 pl-4">
          {selectedFile ? (
            <div
              onClick={segmentsClickable ? undefined : onRevealFile}
              className={`flex min-w-0 flex-1 basis-32 items-center overflow-hidden ${
                segmentsClickable ? '' : 'cursor-pointer'
              }`}
            >
              <nav
                className="flex max-w-full min-w-0 items-center gap-1 overflow-hidden text-ds-text-base text-ds-ink-muted-default"
                aria-label={t('folder.file-path-breadcrumb', {
                  defaultValue: 'File path',
                })}
                title={breadcrumbSegments.join(' / ')}
              >
                {breadcrumbSegments.map((segment, index) => {
                  const isLast = index === breadcrumbSegments.length - 1;
                  const isClickable = segmentsClickable && !isLast;
                  const segmentClassName = cn(
                    'min-w-0 truncate',
                    isLast
                      ? 'shrink font-bold text-ds-ink-default-default'
                      : 'min-w-[1.25em] shrink-[1000] font-normal'
                  );
                  return (
                    <Fragment key={`${index}-${segment}`}>
                      {index > 0 ? (
                        <ChevronRight
                          className="h-3.5 w-3.5 shrink-0 text-ds-ink-muted-default"
                          aria-hidden
                        />
                      ) : null}
                      {isClickable ? (
                        <button
                          type="button"
                          onClick={() => onBreadcrumbSegmentClick?.(index)}
                          className={cn(
                            segmentClassName,
                            'cursor-pointer text-ds-ink-muted-default hover:text-ds-ink-default-default hover:underline'
                          )}
                          title={segment}
                        >
                          {segment}
                        </button>
                      ) : (
                        <span className={segmentClassName} title={segment}>
                          {segment}
                        </span>
                      )}
                    </Fragment>
                  );
                })}
              </nav>
            </div>
          ) : (
            <div className="min-w-0 flex-1" />
          )}
          <div className="scrollbar-hide ml-auto flex max-w-full shrink-0 items-center gap-1 overflow-x-auto">
            {supportsRichView ? (
              <div
                role="group"
                aria-label={t('folder.view-mode', {
                  defaultValue: 'View mode',
                })}
                className="flex h-8 items-center rounded-[6px] bg-ds-neutral-subtle-default p-0.5"
              >
                <button
                  type="button"
                  onClick={isShowSourceCode ? onToggleSourceCode : undefined}
                  aria-pressed={!isShowSourceCode}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-[5px] border-0 border-x-0 border-y-0 px-2 text-xs transition-colors',
                    !isShowSourceCode
                      ? 'bg-ds-neutral-default-default font-medium text-ds-ink-default-default shadow-sm'
                      : 'cursor-pointer bg-transparent text-ds-ink-muted-default hover:text-ds-ink-default-default'
                  )}
                >
                  <Eye className="size-3.5" aria-hidden />
                  {previewViewLabel}
                </button>
                <button
                  type="button"
                  onClick={!isShowSourceCode ? onToggleSourceCode : undefined}
                  aria-pressed={isShowSourceCode}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-[5px] border-0 border-x-0 border-y-0 px-2 text-xs transition-colors',
                    isShowSourceCode
                      ? 'bg-ds-neutral-default-default font-medium text-ds-ink-default-default shadow-sm'
                      : 'cursor-pointer bg-transparent text-ds-ink-muted-default hover:text-ds-ink-default-default'
                  )}
                >
                  <CodeXml className="size-3.5" aria-hidden />
                  {sourceViewLabel}
                </button>
              </div>
            ) : null}

            {openInActions.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    buttonContent="text"
                  >
                    {t('folder.open-in', { defaultValue: 'Open in' })}
                    <ChevronDown className="size-ds-icon-md" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="z-50 min-w-[12rem] border-ds-hairline-default-default bg-ds-neutral-strong-default"
                >
                  {openInActions.map((action) => (
                    <DropdownMenuItem
                      key={action.id}
                      onClick={action.onSelect}
                      className="cursor-pointer gap-2 bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                    >
                      {action.icon}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}

            {onToggleFileTree ? (
              <TooltipSimple
                content={
                  isFileTreeOpen
                    ? t('chat.hide-file-sidebar', {
                        defaultValue: 'Hide file tree',
                      })
                    : t('chat.show-file-sidebar', {
                        defaultValue: 'Show file tree',
                      })
                }
                variant="instant"
              >
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  aria-label={
                    isFileTreeOpen
                      ? t('chat.hide-file-sidebar', {
                          defaultValue: 'Hide file tree',
                        })
                      : t('chat.show-file-sidebar', {
                          defaultValue: 'Show file tree',
                        })
                  }
                  aria-expanded={Boolean(isFileTreeOpen)}
                  aria-controls={fileTreeControlsId}
                  onClick={onToggleFileTree}
                >
                  {isFileTreeOpen ? (
                    <PanelRightClose className="size-4" aria-hidden />
                  ) : (
                    <PanelRight className="size-4" aria-hidden />
                  )}
                </Button>
              </TooltipSimple>
            ) : null}
            {headerActionsExtra}
          </div>
        </div>
      )}

      {/* content */}
      <div
        className={`flex min-h-0 flex-1 flex-col ${
          showsHtmlPreview || showsCodeSource
            ? 'overflow-hidden'
            : 'scrollbar-always-visible overflow-y-auto'
        }`}
      >
        <div
          className={`flex flex-col ${
            showsHtmlPreview || showsCodeSource
              ? 'h-full min-h-0'
              : 'min-h-full py-2 pr-2 pl-4'
          } file-viewer-content`}
        >
          {selectedFile ? (
            !loading ? (
              selectedFile.isFolder ? (
                <div className="flex h-full min-h-64 w-full items-center justify-center px-6 py-10">
                  <div className="flex max-w-md flex-col items-center gap-2 text-center">
                    <FolderOpen className="size-10 text-ds-ink-muted-default" />
                    <p className="m-0 text-ds-text-body-large font-semibold text-ds-ink-default-default">
                      {selectedFile.name}
                    </p>
                    <p className="m-0 text-ds-text-base text-ds-ink-muted-default">
                      {openInActions.length
                        ? t('folder.folder-selected-open-in-description', {
                            defaultValue:
                              'Use Open in to open this exact folder in Finder or an editor.',
                          })
                        : t('folder.folder-selected-preview-description', {
                            defaultValue:
                              'Select a file inside this folder to preview its contents.',
                          })}
                    </p>
                  </div>
                </div>
              ) : selectedFile.preview?.kind === 'blocked' ? (
                <BlockedPreviewPlaceholder
                  file={selectedFile}
                  onRevealFile={onOpenExternalFile || onRevealFile}
                  onDownloadFile={onDownloadFile}
                />
              ) : selectedFile.preview?.kind === 'csv' ? (
                <CsvPreviewTable preview={selectedFile.preview} />
              ) : ['md', 'markdown'].includes(selectedType) &&
                !isShowSourceCode ? (
                <div className="mx-auto w-full max-w-4xl">
                  <TruncatedPreviewNotice file={selectedFile} />
                  <MarkDown
                    content={selectedFile.content || ''}
                    enableTypewriter={false}
                    profile="document"
                    contentBasePath={
                      selectedFile.isRemote
                        ? null
                        : getDirPath(selectedFile.path)
                    }
                  />
                </div>
              ) : selectedType === 'pdf' ? (
                <iframe
                  src={selectedFile.content as string}
                  className="h-full w-full border-0 border-x-0 border-y-0"
                  title={selectedFile.name}
                />
              ) : ['doc', 'docx', 'pptx', 'xlsx'].includes(selectedType) ? (
                <FolderComponent selectedFile={selectedFile} />
              ) : ['html', 'htm'].includes(selectedType) ? (
                isShowSourceCode ||
                selectedFile.preview?.kind === 'truncated-text' ? (
                  <SourceFilePreview
                    file={selectedFile}
                    appearance={appearance}
                  />
                ) : (
                  <HtmlRenderer
                    selectedFile={selectedFile}
                    projectFiles={projectFiles}
                  />
                )
              ) : selectedType === 'zip' ? (
                <div className="flex h-full w-full items-center justify-center text-ds-ink-muted-default">
                  <div className="text-center">
                    <FileText className="mx-auto mb-4 h-12 w-12 text-ds-ink-muted-default" />
                    <p className="text-sm">
                      {t('folder.zip-file-is-not-supported-yet')}
                    </p>
                  </div>
                </div>
              ) : isAudioFile(selectedFile) ? (
                <div className="flex h-full w-full items-center justify-center">
                  <AudioLoader selectedFile={selectedFile} />
                </div>
              ) : isVideoFile(selectedFile) ? (
                <div className="flex h-full w-full items-center justify-center">
                  <VideoLoader selectedFile={selectedFile} />
                </div>
              ) : isImageFile(selectedFile) ? (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageLoader selectedFile={selectedFile} />
                </div>
              ) : (
                <SourceFilePreview
                  file={selectedFile}
                  appearance={appearance}
                />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full"></div>
                  <p className="text-ds-text-base text-ds-ink-muted-default">
                    {t('chat.loading')}
                  </p>
                </div>
              </div>
            )
          ) : (
            (emptyState ?? (
              <div className="flex h-full w-full flex-1 items-center justify-center text-ds-ink-muted-default">
                <div className="text-center">
                  <FileText className="mx-auto mb-4 h-12 w-12 text-ds-ink-muted-default" />
                  <p className="text-sm">
                    {t('chat.select-a-file-to-view-its-contents')}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
