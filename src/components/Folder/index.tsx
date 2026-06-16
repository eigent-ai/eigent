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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  CodeXml,
  Download,
  File,
  FileArchive,
  FileCode,
  FileJson,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Image,
  Music,
  Search,
  SquareTerminal,
  Table2,
  Video,
} from 'lucide-react';
import {
  createElement,
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import FolderComponent from './FolderComponent';

import { fetchGet, getBaseURL } from '@/api/http';
import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useSelectedProjectTurn } from '@/hooks/useSelectedProjectTurn';
import { useHost } from '@/host';
import { filterVisibleAgentFiles } from '@/lib/agentFileFilters';
import {
  deferInlineScriptsUntilLoad,
  injectFontStyles,
} from '@/lib/htmlFontStyles';
import {
  inlineLocalHtmlImgElements,
  inlineLocalProjectImagePaths,
  toLocalFileUrl,
} from '@/lib/htmlLocalAssets';
import { containsDangerousContent } from '@/lib/htmlSanitization';
import { isLocalWorkspaceSpace } from '@/lib/spaceLabel';
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

function treeSegmentLabel(value?: string | null, fallback = 'Project') {
  const trimmed = (value || '').trim();
  return (trimmed || fallback).replace(/[\\/]/g, '-');
}

function isImageFile(file: FileTypeTarget) {
  return IMAGE_EXTENSIONS.includes(getFileType(file));
}
function isAudioFile(file: FileTypeTarget) {
  return AUDIO_EXTENSIONS.includes(getFileType(file));
}
function isVideoFile(file: FileTypeTarget) {
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
interface FileTreeNode {
  name: string;
  path: string;
  type?: string;
  projectId?: string;
  isFolder?: boolean;
  icon?: React.ElementType;
  children?: FileTreeNode[];
  isRemote?: boolean;
  relativePath?: string;
}

function filterFileTree(node: FileTreeNode, query: string): FileTreeNode {
  const q = query.trim().toLowerCase();
  if (!q || !node.children?.length) {
    return node;
  }
  const filteredChildren: FileTreeNode[] = [];
  for (const child of node.children) {
    if (child.isFolder) {
      const filtered = filterFileTree(child, query);
      if (filtered.children?.length) {
        filteredChildren.push(filtered);
      }
    } else if (child.name.toLowerCase().includes(q)) {
      filteredChildren.push(child);
    }
  }
  return { ...node, children: filteredChildren };
}

/** Keep folder hierarchy; only include file leaves whose `path` is in the set. */
function filterTreeToAllowedLeafPaths(
  node: FileTreeNode,
  allowedLeafPaths: Set<string>
): FileTreeNode | null {
  if (!node.children?.length) return null;
  const children: FileTreeNode[] = [];
  for (const child of node.children) {
    if (child.isFolder) {
      const nested = filterTreeToAllowedLeafPaths(child, allowedLeafPaths);
      if (nested?.children?.length) {
        children.push(nested);
      }
    } else if (allowedLeafPaths.has(child.path)) {
      children.push(child);
    }
  }
  if (!children.length) return null;
  return { ...node, children };
}

function pathsFromFileList(res: unknown[] | null): Set<string> {
  const s = new Set<string>();
  for (const item of res || []) {
    const p = (item as { path?: string; url?: string })?.path;
    const u = (item as { url?: string })?.url;
    if (p) s.add(p);
    else if (u) s.add(u);
  }
  return s;
}

interface FileInfo {
  name: string;
  path: string;
  type: string;
  projectId?: string;
  isFolder?: boolean;
  icon?: React.ElementType;
  content?: string;
  relativePath?: string;
  isRemote?: boolean;
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

function isSameFileIdentity(
  left?: FileInfo | null,
  right?: FileInfo | null
): boolean {
  if (!left || !right) return false;
  const leftRel = getComparableRelativePath(left);
  const rightRel = getComparableRelativePath(right);
  if (leftRel && rightRel) return leftRel === rightRel;
  return left.path === right.path;
}

function findMatchingFile(
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
function getFileBreadcrumbSegments(
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
interface FileTreeProps {
  node: FileTreeNode;
  level?: number;
  selectedFile: FileInfo | null;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onSelectFile: (file: FileInfo) => void;
  isShowSourceCode: boolean;
}

export const FileTree: React.FC<FileTreeProps> = ({
  node,
  level = 0,
  selectedFile,
  expandedFolders,
  onToggleFolder,
  onSelectFile,
  isShowSourceCode,
}) => {
  if (!node.children || node.children.length === 0) return null;

  return (
    <div className="min-w-0">
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
        };

        const isRowSelected = isSameFileIdentity(selectedFile, fileInfo);
        const rowIconClass = `size-4 shrink-0 ${
          isRowSelected
            ? 'text-ds-icon-neutral-default-default'
            : 'text-ds-icon-neutral-muted-default'
        }`;

        return (
          <div key={child.path} className="min-w-0">
            <button
              type="button"
              onClick={() => {
                if (child.isFolder) {
                  onToggleFolder(child.path);
                } else {
                  onSelectFile(fileInfo);
                }
              }}
              className={`mb-1 flex w-full min-w-0 flex-row items-center justify-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-ds-bg-neutral-subtle-hover ${
                isRowSelected
                  ? 'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
                  : 'bg-transparent text-ds-text-neutral-muted-default'
              }`}
            >
              {child.isFolder ? (
                <span className="inline-flex w-4 shrink-0 items-center justify-start">
                  {isExpanded ? (
                    <ChevronDown className={rowIconClass} />
                  ) : (
                    <ChevronRight className={rowIconClass} />
                  )}
                </span>
              ) : (
                createElement(
                  child.icon ??
                    getLeafFileTreeIcon({
                      name: child.name,
                      path: child.path,
                      type: child.type,
                    }),
                  { className: rowIconClass }
                )
              )}

              <span className="min-w-0 flex-1 truncate text-left text-body-sm font-medium leading-normal">
                {child.name}
              </span>
            </button>

            {hasNested ? (
              <div className="ml-4 border-y-0 border-l border-r-0 border-solid border-ds-border-neutral-subtle-default pl-1">
                <FileTree
                  node={child}
                  level={level + 1}
                  selectedFile={selectedFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onSelectFile={onSelectFile}
                  isShowSourceCode={isShowSourceCode}
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
async function downloadFromUrl(
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
      const response = await fetch(trimmed, { credentials: 'include' });
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
async function downloadOpenedFile(file: FileInfo): Promise<void> {
  if (file.isFolder || (!file.path && file.content === undefined)) return;

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

export default function Folder({ data: _data }: { data?: Agent }) {
  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const authStore = useAuthStore();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeProjectId = projectStore.activeProjectId;
  const selectedTurn = useSelectedProjectTurn(activeProjectId);
  const activeProjectMeta = useSpaceStore((s) =>
    activeProjectId ? s.getProjectMeta(activeProjectId) : null
  );
  const resolvedSpaceId =
    activeProjectMeta?.spaceId || activeSpaceId || undefined;
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
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
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
  const priorFilePathsSnapshotRef = useRef<Set<string>>(new Set());
  const [fileTreeScope, setFileTreeScope] = useState<'all' | 'new'>('all');
  const [newFilePathsAccumulated, setNewFilePathsAccumulated] = useState<
    Set<string>
  >(() => new Set());
  const [isFileSidebarOpen, setIsFileSidebarOpen] = useState(true);

  const rememberSelectedFile = (file: FileInfo) => {
    if (!selectedTurn.chatStore || !selectedTurn.taskId) return;
    selectedTurn.chatStore
      .getState()
      .setSelectedFile(selectedTurn.taskId, file);
  };

  const filteredFileTree = useMemo(
    () => filterFileTree(fileTree, fileSearchQuery),
    [fileTree, fileSearchQuery]
  );

  const sidebarFileTree = useMemo(() => {
    if (fileTreeScope === 'all') return filteredFileTree;
    if (newFilePathsAccumulated.size === 0) {
      return {
        name: 'root',
        path: '',
        children: [],
        isFolder: true,
      } satisfies FileTreeNode;
    }
    const filtered = filterTreeToAllowedLeafPaths(
      filteredFileTree,
      newFilePathsAccumulated
    );
    return (
      filtered ?? {
        name: 'root',
        path: '',
        children: [],
        isFolder: true,
      }
    );
  }, [filteredFileTree, fileTreeScope, newFilePathsAccumulated]);

  const selectedFileChange = (file: FileInfo, isShowSourceCode?: boolean) => {
    const isWebMode = !ipcRenderer?.invoke;

    if (file.type === 'zip') {
      // if file is remote, don't call reveal-in-folder
      if (file.isRemote) {
        void downloadFromUrl(file.path, file.name);
        return;
      }
      ipcRenderer?.invoke('reveal-in-folder', file.path);
      return;
    }
    // Don't open folders in preview - they are handled by expand/collapse
    if (file.isFolder) {
      return;
    }
    setSelectedFile(file);
    setLoading(true);
    console.log('file', JSON.parse(JSON.stringify(file)));

    if (file.isRemote && file.path?.startsWith('http')) {
      if (isImageFile(file)) {
        const loadRemoteImage = async () => {
          try {
            const content = await fetchRemoteFileAsDataUrl(file.path);
            setSelectedFile({ ...file, content });
            rememberSelectedFile(file);
          } catch (error) {
            console.error('Failed to load remote image:', error);
            setSelectedFile({ ...file });
            rememberSelectedFile(file);
          } finally {
            setLoading(false);
          }
        };
        void loadRemoteImage();
        return;
      }

      if (isAudioFile(file) || isVideoFile(file)) {
        setSelectedFile({ ...file });
        rememberSelectedFile(file);
        setLoading(false);
        return;
      }

      if (!isWebMode && ipcRenderer) {
        ipcRenderer
          .invoke('open-file', file.type, file.path, isShowSourceCode)
          .then((res: string) => {
            setSelectedFile({ ...file, content: res });
            rememberSelectedFile(file);
            setLoading(false);
          })
          .catch((error: unknown) => {
            console.error('open-file error:', error);
            setLoading(false);
          });
        return;
      }

      const loadRemoteContent = async () => {
        try {
          const resp = await fetch(file.path);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const contentType = resp.headers.get('content-type') || '';
          let content: string;
          if (file.type === 'pdf' || contentType.includes('application/pdf')) {
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
          setSelectedFile({ ...file, content });
          rememberSelectedFile(file);
        } catch (error) {
          console.error('Failed to load remote file:', error);
        } finally {
          setLoading(false);
        }
      };
      void loadRemoteContent();
      return;
    }

    // For PDF files, use data URL instead of custom protocol
    if (file.type === 'pdf') {
      if (ipcRenderer) {
        ipcRenderer
          .invoke('read-file-dataurl', file.path)
          .then((dataUrl: string) => {
            setSelectedFile({ ...file, content: dataUrl });
            rememberSelectedFile(file);
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

    // For audio/video files, skip open-file — loaders handle reading themselves
    if (isAudioFile(file) || isVideoFile(file)) {
      setSelectedFile({ ...file });
      rememberSelectedFile(file);
      setLoading(false);
      return;
    }

    // all other files call open-file interface, the backend handles download and parsing
    if (ipcRenderer) {
      ipcRenderer
        .invoke('open-file', file.type, file.path, isShowSourceCode)
        .then((res: string) => {
          setSelectedFile({ ...file, content: res });
          rememberSelectedFile(file);
          setLoading(false);
        })
        .catch((error: unknown) => {
          console.error('open-file error:', error);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  };

  const isShowSourceCodeChange = () => {
    // all files can reload content
    selectedFileChange(selectedFile!, !isShowSourceCode);
    setIsShowSourceCode(!isShowSourceCode);
  };

  const buildFileTree = (files: FileInfo[]): FileTreeNode => {
    const root: FileTreeNode = {
      name: 'root',
      path: '',
      children: [],
      isFolder: true,
    };

    const folderMap = new Map<string, FileTreeNode>();
    folderMap.set('', root);

    const ensureFolderNode = (segments: string[]): FileTreeNode => {
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
          };
          parentNode.children!.push(folderNode);
          folderMap.set(currentFolderPath, folderNode);
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
        ensureFolderNode(pathSegments);
        continue;
      }

      const folderSegments = pathSegments.slice(0, -1);
      const fileName = pathSegments[pathSegments.length - 1] || file.name;
      const parentNode = ensureFolderNode(folderSegments);

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

  const activeTaskId = selectedTurn.taskId ?? undefined;
  const taskAssigning = selectedTurn.task?.taskAssigning;
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
  const fetchKey = `${fileSpaceId || ''}|${useSpaceScopedRemoteFiles ? 'space' : 'project'}|${projectFetchKey}|${activeTaskId || ''}`;
  const fileContextResetKey =
    useSpaceScopedRemoteFiles || useBrainWorkspaceFiles
      ? fileSpaceId
      : activeTaskId;
  const taskRunning =
    !!taskAssigning?.length &&
    taskAssigning.some(
      (agent) => agent.status === 'running' || agent.status === 'pending'
    );

  // Reset state when the file context changes.
  useEffect(() => {
    hasFetchedRemote.current = false;
    setSelectedFile(null);
    setFileTree({ name: 'root', path: '', children: [], isFolder: true });
    setFileGroups([{ folder: 'Reports', files: [] }]);
    fileListRef.current = [];
    setExpandedFolders(new Set());
    priorFilePathsSnapshotRef.current = new Set();
    setNewFilePathsAccumulated(new Set());
    setFileTreeScope('all');
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
      if (!authStore.email || !projectStore.activeProjectId) {
        setWorkingFolderPath(null);
        return;
      }
      if (typeof electronAPI?.getProjectFolderPath !== 'function') {
        setWorkingFolderPath(null);
        return;
      }
      try {
        const folderPath = await electronAPI.getProjectFolderPath(
          authStore.email,
          projectStore.activeProjectId as string
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
    projectStore.activeProjectId,
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
            primaryProjectId
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
        import.meta.env.VITE_USE_LOCAL_PROXY === 'true' ||
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
                const relativePath = item.relativePath || filename;
                return {
                  name: filename,
                  type: filename.split('.').pop() || '',
                  path: url,
                  projectId: target.id,
                  relativePath: useSpaceScopedRemoteFiles
                    ? `${target.name}/${relativePath}`
                    : relativePath,
                  isRemote: true,
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
      if (nextVisibleFiles && Array.isArray(nextVisibleFiles)) {
        const currentPaths = pathsFromFileList(nextVisibleFiles);
        const prior = priorFilePathsSnapshotRef.current;
        const isFirstPopulate = prior.size === 0 && currentPaths.size > 0;
        if (isFirstPopulate) {
          priorFilePathsSnapshotRef.current = new Set(currentPaths);
        } else {
          const added = new Set<string>();
          for (const p of currentPaths) {
            if (!prior.has(p)) added.add(p);
          }
          priorFilePathsSnapshotRef.current = new Set(currentPaths);
          if (added.size > 0) {
            setNewFilePathsAccumulated((prev) => {
              const next = new Set(prev);
              for (const p of added) next.add(p);
              return next;
            });
          }
        }
      }
      setFileTree(tree);
      // Keep the old structure for compatibility
      setFileGroups((prev) => {
        const chatStoreSelectedFile = selectedTurn.task?.selectedFile;
        if (chatStoreSelectedFile) {
          const file = findMatchingFile(
            nextVisibleFiles,
            chatStoreSelectedFile
          );
          if (file) {
            setFileTreeScope('all');
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
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let inFlightController: AbortController | null = null;
    let inFlightMode: 'full' | 'merge' | null = null;

    const activeProjectFetchTargets = () => {
      const targets = projectFetchTargetsRef.current;
      if (!taskRunning) return targets;
      const activeTargets = targets.filter((target) => target.id === projectId);
      return activeTargets.length ? activeTargets : targets.slice(0, 1);
    };

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
        });
    };

    if (shouldFetch) {
      debounceTimer = setTimeout(() => {
        lastFetchKey.current = fetchKey;
        runFileList(projectFetchTargetsRef.current, { merge: false });
      }, 120);
    }

    if (taskRunning && isFileSidebarOpen) {
      pollTimer = setInterval(() => {
        runFileList(activeProjectFetchTargets(), { merge: true });
      }, 5000);
    }

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (pollTimer) clearInterval(pollTimer);
      inFlightController?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fetchKey,
    taskRunning,
    projectId,
    fileSpaceId,
    activeTaskId,
    authStore.email,
    authStore.user_id,
    isFileSidebarOpen,
    projectFetchKey,
    useBrainWorkspaceFiles,
    useSpaceScopedRemoteFiles,
  ]);

  useEffect(() => {
    hasFetchedRemote.current = false;
  }, [projectId, activeTaskId]);

  const selectedFilePath = selectedTurn.task?.selectedFile?.path;

  useEffect(() => {
    const chatStoreSelectedFile = selectedTurn.task?.selectedFile;
    if (chatStoreSelectedFile && fileGroups[0]?.files) {
      const file = findMatchingFile(fileGroups[0].files, chatStoreSelectedFile);
      if (file) {
        setFileTreeScope('all');
        setIsFileSidebarOpen(true);
        expandFoldersForFile(file as FileInfo);
        if (!isSameFileIdentity(selectedFile, file)) {
          selectedFileChange(file as FileInfo, isShowSourceCode);
        }
      }
    } else if (!chatStoreSelectedFile && selectedFile) {
      setSelectedFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilePath, fileGroups, isShowSourceCode, selectedTurn.taskId]);

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

  if (!chatStore && !activeSpace) {
    return <div>Loading...</div>;
  }

  const _handleBack = () => {
    if (!chatStore?.activeTaskId) return;
    chatStore.setActiveWorkspace(chatStore.activeTaskId as string, 'workflow');
  };

  const handleOpenInIDE = async (ide: 'vscode' | 'cursor' | 'system') => {
    try {
      if (!authStore.email) return;
      if (!electronAPI) return;
      let folderPath = activeSpace?.rootPath || '';
      if (
        !folderPath &&
        projectStore.activeProjectId &&
        typeof electronAPI.getProjectFolderPath === 'function'
      ) {
        folderPath = await electronAPI.getProjectFolderPath(
          authStore.email,
          projectStore.activeProjectId
        );
      }
      if (!folderPath) return;

      if (ide === 'system' && selectedFile && !selectedFile.isFolder) {
        const p = selectedFile.path?.trim() ?? '';
        const isLocalFsPath =
          p.length > 0 && !selectedFile.isRemote && !/^https?:\/\//i.test(p);
        if (isLocalFsPath && ipcRenderer?.invoke) {
          await ipcRenderer.invoke('reveal-in-folder', p);
          authStore.setPreferredIDE(ide);
          return;
        }
      }

      const result = await electronAPI.openInIDE(folderPath, ide);
      if (!result.success) {
        toast.error(result.error || t('chat.failed-to-open-folder'));
      } else {
        authStore.setPreferredIDE(ide);
      }
    } catch (error) {
      console.error('Failed to open in IDE:', error);
      toast.error(t('chat.failed-to-open-folder'));
    }
  };

  const folderHeaderTitle =
    activeSpace?.name?.trim() || t('layout.spaces-untitled');
  const canOpenInExternalEditor = Boolean(
    electronAPI?.openInIDE &&
    (activeSpace?.rootPath || electronAPI?.getProjectFolderPath)
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* header */}
      <div className="border-b-1 flex w-full shrink-0 items-center gap-2 border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-default p-2">
        <div className="flex min-w-0 max-w-[min(20rem,45%)] items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-pressed={isFileSidebarOpen}
            className="shrink-0 text-ds-icon-neutral-default-default"
            aria-label={
              isFileSidebarOpen
                ? t('chat.hide-file-sidebar', {
                    defaultValue: 'Hide file sidebar',
                  })
                : t('chat.show-file-sidebar', {
                    defaultValue: 'Show file sidebar',
                  })
            }
            title={
              isFileSidebarOpen
                ? t('chat.hide-file-sidebar', {
                    defaultValue: 'Hide file sidebar',
                  })
                : t('chat.show-file-sidebar', {
                    defaultValue: 'Show file sidebar',
                  })
            }
            onClick={() => setIsFileSidebarOpen((open) => !open)}
          >
            {isFileSidebarOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <FolderIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
          </Button>
          <span
            className="min-w-0 truncate text-body-sm font-semibold leading-none text-ds-text-neutral-default-default"
            title={folderHeaderTitle}
          >
            {folderHeaderTitle}
          </span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <div className="relative h-7 w-32 min-w-[10rem] max-w-xs shrink-0 rounded-lg">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-text-brand-default-default" />
            <input
              type="text"
              value={fileSearchQuery}
              onChange={(e) => setFileSearchQuery(e.target.value)}
              placeholder={t('chat.search')}
              className="h-7 w-full rounded-lg border border-solid border-ds-border-neutral-subtle-default py-0 pl-7 pr-2 text-sm leading-none focus:outline-none focus:ring-2 focus:ring-ds-ring-brand-default-focus focus:ring-offset-0"
              aria-label={t('chat.search')}
            />
          </div>
          {canOpenInExternalEditor && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="primary"
                  size="sm"
                  buttonContent="text"
                  textWeight="semibold"
                  tone="neutral"
                >
                  <SquareTerminal className="shrink-0" />
                  {t('chat.open-in-ide')}
                  <ChevronDown className="shrink-0 opacity-80" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="z-50 border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default"
              >
                <DropdownMenuItem
                  onClick={() => handleOpenInIDE('system')}
                  className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                >
                  <FolderIcon className="size-4 shrink-0" aria-hidden />
                  {t('chat.open-in-file-manager')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleOpenInIDE('cursor')}
                  className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                >
                  <img
                    src={cursorIcon}
                    alt=""
                    className="size-4 shrink-0"
                    aria-hidden
                  />
                  {t('chat.open-in-cursor')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleOpenInIDE('vscode')}
                  className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                >
                  <img
                    src={vsCodeIcon}
                    alt=""
                    className="size-4 shrink-0"
                    aria-hidden
                  />
                  {t('chat.open-in-vscode')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* sidebar */}
        {isFileSidebarOpen ? (
          <div className="flex h-full w-64 flex-shrink-0 flex-col border-y-0 border-l-0 border-r border-solid border-ds-border-neutral-subtle-default">
            <div className="flex h-8 items-center px-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    buttonContent="text"
                  >
                    <span className="min-w-0 truncate text-left font-bold">
                      {t('chat.files')}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="z-50 min-w-[10rem] border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default"
                >
                  <DropdownMenuRadioGroup
                    value={fileTreeScope}
                    onValueChange={(v) =>
                      setFileTreeScope(v === 'new' ? 'new' : 'all')
                    }
                  >
                    <DropdownMenuRadioItem
                      value="all"
                      className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                    >
                      {t('folder.files-scope-all', {
                        defaultValue: 'All files',
                      })}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="new"
                      className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                    >
                      {t('folder.files-scope-new', {
                        defaultValue: 'New files',
                      })}
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto">
              <div className="h-full pl-1.5">
                <FileTree
                  node={sidebarFileTree}
                  selectedFile={selectedFile}
                  expandedFolders={expandedFolders}
                  onToggleFolder={toggleFolder}
                  onSelectFile={(file) =>
                    selectedFileChange(file, isShowSourceCode)
                  }
                  isShowSourceCode={isShowSourceCode}
                />
              </div>
            </div>
          </div>
        ) : null}

        {/* content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-ds-bg-neutral-subtle-default">
          {/* head */}
          {selectedFile && (
            <div className="flex h-8 flex-shrink-0 items-center justify-between gap-2 pl-3 pr-2">
              <div
                onClick={() => {
                  // if file is remote, don't call reveal-in-folder
                  if (selectedFile.isRemote) {
                    void downloadFromUrl(selectedFile.path, selectedFile.name);
                    return;
                  }
                  ipcRenderer?.invoke('reveal-in-folder', selectedFile.path);
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center overflow-hidden"
              >
                <nav
                  className="scrollbar-always-visible flex min-w-0 max-w-full items-center gap-1 overflow-x-auto text-body-sm text-ds-text-neutral-muted-default"
                  aria-label={t('folder.file-path-breadcrumb', {
                    defaultValue: 'File path',
                  })}
                >
                  {fileBreadcrumbSegments.map((segment, index) => {
                    const isLast = index === fileBreadcrumbSegments.length - 1;
                    return (
                      <Fragment key={`${index}-${segment}`}>
                        {index > 0 ? (
                          <ChevronRight
                            className="h-3.5 w-3.5 shrink-0 text-ds-icon-neutral-muted-default"
                            aria-hidden
                          />
                        ) : null}
                        <span
                          className={
                            isLast
                              ? 'shrink-0 font-bold text-ds-text-neutral-default-default'
                              : 'shrink-0 font-normal'
                          }
                        >
                          {segment}
                        </span>
                      </Fragment>
                    );
                  })}
                </nav>
              </div>
              <div className="flex flex-shrink-0 items-center gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  type="button"
                  aria-label={t('folder.download-file', {
                    defaultValue: 'Download file',
                  })}
                  onClick={() => {
                    if (!selectedFile || selectedFile.isFolder) return;
                    void downloadOpenedFile(selectedFile);
                  }}
                >
                  <Download className="h-4 w-4 text-ds-icon-neutral-muted-default" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => isShowSourceCodeChange()}
                >
                  <CodeXml className="h-4 w-4 text-ds-icon-neutral-muted-default" />
                </Button>
              </div>
            </div>
          )}

          {/* content */}
          <div
            className={`flex min-h-0 flex-1 flex-col ${
              selectedFile?.type === 'html' && !isShowSourceCode
                ? 'overflow-hidden'
                : 'scrollbar-always-visible overflow-y-auto'
            }`}
          >
            <div
              className={`flex flex-col ${
                selectedFile?.type === 'html' && !isShowSourceCode
                  ? 'h-full min-h-0'
                  : 'min-h-full py-2 pl-4 pr-2'
              } file-viewer-content`}
            >
              {selectedFile ? (
                !loading ? (
                  selectedFile.type === 'md' && !isShowSourceCode ? (
                    <div className="prose prose-sm max-w-none">
                      <MarkDown
                        content={selectedFile.content || ''}
                        enableTypewriter={false}
                        contentBasePath={
                          selectedFile.isRemote
                            ? null
                            : getDirPath(selectedFile.path)
                        }
                      />
                    </div>
                  ) : selectedFile.type === 'pdf' ? (
                    <iframe
                      src={selectedFile.content as string}
                      className="h-full w-full border-0"
                      title={selectedFile.name}
                    />
                  ) : ['csv', 'doc', 'docx', 'pptx', 'xlsx'].includes(
                      selectedFile.type
                    ) ? (
                    <FolderComponent selectedFile={selectedFile} />
                  ) : selectedFile.type === 'html' ? (
                    isShowSourceCode ? (
                      <>{selectedFile.content}</>
                    ) : (
                      <HtmlRenderer
                        selectedFile={selectedFile}
                        projectFiles={fileGroups[0]?.files || []}
                      />
                    )
                  ) : selectedFile.type === 'zip' ? (
                    <div className="flex h-full w-full items-center justify-center text-ds-text-neutral-muted-default">
                      <div className="text-center">
                        <FileText className="mx-auto mb-4 h-12 w-12 text-ds-text-neutral-muted-default" />
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
                    <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-sm text-ds-text-neutral-default-default">
                      {selectedFile.content}
                    </pre>
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-center">
                      <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full"></div>
                      <p className="text-body-sm text-ds-text-neutral-muted-default">
                        {t('chat.loading')}
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex h-full w-full flex-1 items-center justify-center text-ds-text-neutral-muted-default">
                  <div className="text-center">
                    <FileText className="mx-auto mb-4 h-12 w-12 text-ds-text-neutral-muted-default" />
                    <p className="text-sm">
                      {t('chat.select-a-file-to-view-its-contents')}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function toFileUrl(filePath: string): string {
  if (
    filePath.startsWith('file://') ||
    filePath.startsWith('localfile://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('blob:') ||
    filePath.startsWith('data:')
  ) {
    return filePath;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');

  // Windows UNC path: //server/share/path/to/file
  if (normalizedPath.startsWith('//')) {
    const withoutLeadingSlashes = normalizedPath.replace(/^\/+/, '');
    const [host, ...pathSegments] = withoutLeadingSlashes.split('/');
    const encodedPath = pathSegments.map(encodeURIComponent).join('/');
    return encodedPath ? `file://${host}/${encodedPath}` : `file://${host}/`;
  }

  const hasWindowsDrive = /^[A-Za-z]:\//.test(normalizedPath);
  if (hasWindowsDrive) {
    const [drive, ...pathSegments] = normalizedPath.split('/');
    const encodedPath = pathSegments.map(encodeURIComponent).join('/');
    return encodedPath
      ? `file:///${drive}/${encodedPath}`
      : `file:///${drive}/`;
  }

  const encodedPath = normalizedPath
    .split('/')
    .map((segment, index) =>
      index === 0 && segment === '' ? '' : encodeURIComponent(segment)
    )
    .join('/');
  return `file://${encodedPath}`;
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
    // Use file:// source so Chromium can stream/seek large media files.
    setSrc(toFileUrl(selectedFile.path));
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
  const [src, setSrc] = useState('');

  useEffect(() => {
    setSrc('');
    if (selectedFile.isRemote) {
      setSrc(selectedFile.content || selectedFile.path);
      return;
    }
    // Use file:// source so Chromium can stream/seek large media files.
    setSrc(toFileUrl(selectedFile.path));
  }, [selectedFile]);

  return (
    <div className="flex w-full flex-col items-center gap-4 px-8">
      <p className="text-sm font-medium text-ds-text-neutral-default-default">
        {selectedFile.name}
      </p>
      <audio
        controls
        src={src}
        className="w-full"
        onError={(err) => console.error('Audio load error:', err)}
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}

function VideoLoader({ selectedFile }: { selectedFile: FileInfo }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    setSrc('');
    if (selectedFile.isRemote) {
      setSrc(selectedFile.content || selectedFile.path);
      return;
    }
    // Use file:// source so Chromium can stream/seek large media files.
    setSrc(toFileUrl(selectedFile.path));
  }, [selectedFile]);

  return (
    <video
      controls
      src={src}
      className="max-h-full max-w-full object-contain"
      onError={(err) => console.error('Video load error:', err)}
    >
      Your browser does not support video playback.
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

function hasScriptSrcAttribute(script: HTMLScriptElement): boolean {
  return script.hasAttribute('src');
}

function isClassicScriptElement(script: HTMLScriptElement): boolean {
  const rawType = script.getAttribute('type')?.trim() ?? '';
  const normalizedType = rawType.split(';', 1)[0].trim().toLowerCase();
  if (!normalizedType) return true;

  if (normalizedType === 'module' || normalizedType === 'application/ld+json') {
    return false;
  }

  return new Set([
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'application/x-javascript',
    'text/x-javascript',
    'application/x-ecmascript',
    'text/x-ecmascript',
    'text/jscript',
    'text/livescript',
  ]).has(normalizedType);
}

function canParseClassicScript(script: string): boolean {
  try {
    // Parse only. The generated function is never executed.
    new Function(script);
    return true;
  } catch {
    return false;
  }
}

function normalizeGeneratedDoubleBraces(source: string): string {
  return source.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

function repairGeneratedReportBraces(html: string): string {
  if (!html.includes('{{') && !html.includes('}}')) {
    return html;
  }

  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  let repaired = false;

  doc.querySelectorAll('style').forEach((style) => {
    const content = style.textContent ?? '';
    if (!content.includes('{{') && !content.includes('}}')) {
      return;
    }

    const normalizedContent = normalizeGeneratedDoubleBraces(content);
    if (normalizedContent !== content) {
      style.textContent = normalizedContent;
      repaired = true;
    }
  });

  doc.querySelectorAll('script').forEach((script) => {
    if (hasScriptSrcAttribute(script) || !isClassicScriptElement(script)) {
      return;
    }

    const content = script.textContent ?? '';
    if (!content.includes('{{') && !content.includes('}}')) {
      return;
    }

    const normalizedContent = normalizeGeneratedDoubleBraces(content);
    if (
      !canParseClassicScript(content) &&
      canParseClassicScript(normalizedContent)
    ) {
      script.textContent = normalizedContent;
      repaired = true;
    }
  });

  return repaired
    ? `${doctype}${doc.documentElement?.outerHTML || html}`
    : html;
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

async function fetchRemoteFileAsDataUrl(url: string): Promise<string> {
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
  const [processedHtml, setProcessedHtml] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const electronAPI = host?.electronAPI;

  useEffect(() => {
    const processHtml = async () => {
      if (!selectedFile.content) {
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
        setProcessedHtml(
          injectFontStyles(deferInlineScriptsUntilLoad(htmlWithStorageShim))
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

      // Set the processed HTML with font styles - iframe sandbox provides security
      setProcessedHtml(injectFontStyles(htmlWithDeferredScripts));
    };

    processHtml().catch((error) => {
      console.error('[HtmlRenderer] Failed to process HTML:', error);
      setProcessedHtml(injectFontStyles(selectedFile.content || ''));
    });
  }, [selectedFile, projectFiles, ipcRenderer, electronAPI]);

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
        className="min-h-0 flex-1 overflow-hidden bg-code-surface"
        onWheel={handleWheel}
      >
        <div
          className="h-full origin-top-left transition-transform duration-150"
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
            className="bg-white h-full w-full border-0"
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
