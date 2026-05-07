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
import {
  fetchRemoteFileAsDataUrl,
  HtmlView,
} from '@/components/Dashboard/HtmlView';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost } from '@/host';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

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
  isFolder?: boolean;
  icon?: React.ElementType;
  content?: string;
  relativePath?: string;
  isRemote?: boolean;
}

function getNormalizedTreeRelativePath(file: FileInfo): string {
  const rel = (file.relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel) return rel;
  return (file.path || file.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
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
  options: { projectRootLabel: string; remoteRootLabel: string }
): string[] {
  if (file.isRemote) {
    return [options.remoteRootLabel, file.name];
  }
  const rel = (file.relativePath || '').replace(/\\/g, '/').trim();
  const folders = rel ? rel.split('/').filter(Boolean) : [];
  return [options.projectRootLabel, ...folders, file.name];
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
              className={`mb-1 min-w-0 gap-2 rounded-lg px-2 py-1.5 hover:bg-ds-bg-neutral-subtle-hover flex w-full flex-row items-center justify-start text-left transition-colors ${
                isRowSelected
                  ? 'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
                  : 'text-ds-text-neutral-muted-default bg-transparent'
              }`}
            >
              {child.isFolder ? (
                <span className="w-4 inline-flex shrink-0 items-center justify-start">
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

              <span className="min-w-0 text-body-sm font-medium leading-normal flex-1 truncate text-left">
                {child.name}
              </span>
            </button>

            {hasNested ? (
              <div className="ml-4 pl-1 border-ds-border-neutral-subtle-default border-y-0 border-r-0 border-l border-solid">
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
  const hasFetchedRemote = useRef(false);
  const lastFetchKey = useRef<string>('');
  const priorFilePathsSnapshotRef = useRef<Set<string>>(new Set());
  const [fileTreeScope, setFileTreeScope] = useState<'all' | 'new'>('all');
  const [newFilePathsAccumulated, setNewFilePathsAccumulated] = useState<
    Set<string>
  >(() => new Set());
  const [isFileSidebarOpen, setIsFileSidebarOpen] = useState(true);

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
            chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
          } catch (error) {
            console.error('Failed to load remote image:', error);
            setSelectedFile({ ...file });
            chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
          } finally {
            setLoading(false);
          }
        };
        void loadRemoteImage();
        return;
      }

      if (isAudioFile(file) || isVideoFile(file)) {
        setSelectedFile({ ...file });
        chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
        setLoading(false);
        return;
      }

      if (!isWebMode && ipcRenderer) {
        ipcRenderer
          .invoke('open-file', file.type, file.path, isShowSourceCode)
          .then((res: string) => {
            setSelectedFile({ ...file, content: res });
            chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
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
          chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
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
            chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
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
      chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
      setLoading(false);
      return;
    }

    // all other files call open-file interface, the backend handles download and parsing
    if (ipcRenderer) {
      ipcRenderer
        .invoke('open-file', file.type, file.path, isShowSourceCode)
        .then((res: string) => {
          setSelectedFile({ ...file, content: res });
          chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
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
      const folderSegments = pathSegments.slice(0, -1);
      const fileName = pathSegments[pathSegments.length - 1] || file.name;

      let parentNode = root;
      let currentFolderPath = '';

      for (const segment of folderSegments) {
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

      parentNode.children!.push({
        name: fileName || file.name,
        path: file.path,
        type: file.type,
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

  // Reset state when activeTaskId changes (e.g., new project created)
  useEffect(() => {
    hasFetchedRemote.current = false;
    setSelectedFile(null);
    setFileTree({ name: 'root', path: '', children: [], isFolder: true });
    setFileGroups([{ folder: 'Reports', files: [] }]);
    setExpandedFolders(new Set());
    priorFilePathsSnapshotRef.current = new Set();
    setNewFilePathsAccumulated(new Set());
    setFileTreeScope('all');
  }, [chatStore?.activeTaskId]);

  useEffect(() => {
    let cancelled = false;
    const loadPath = async () => {
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
  }, [authStore.email, projectStore.activeProjectId, electronAPI]);

  const activeTaskId = chatStore?.activeTaskId as string;
  const activeWorkspace = chatStore?.tasks[activeTaskId]?.activeWorkspace;
  const taskAssigning = chatStore?.tasks[activeTaskId]?.taskAssigning;
  const projectId = (projectStore.activeProjectId as string) || activeTaskId;
  const fetchKey = `${projectId || ''}|${activeTaskId || ''}`;
  const taskRunning =
    !!taskAssigning?.length &&
    taskAssigning.some(
      (agent) => agent.status === 'running' || agent.status === 'pending'
    );

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
    if (!chatStore || !projectId || !authStore.email) return;

    const setFileList = async () => {
      let res: FileInfo[] = [];

      if (ipcRenderer) {
        try {
          const localFiles = await ipcRenderer.invoke(
            'get-project-file-list',
            authStore.email,
            projectId
          );
          if (Array.isArray(localFiles)) {
            res = localFiles;
          }
        } catch (error) {
          console.warn('[Folder] Failed to fetch local project files:', error);
        }
      }

      if (
        !res.length ||
        !ipcRenderer ||
        import.meta.env.VITE_USE_LOCAL_PROXY === 'true'
      ) {
        try {
          const baseURL = await getBaseURL();
          if (!baseURL) {
            console.warn('[Folder] Brain not connected, cannot fetch files');
          } else {
            const listRes = await fetchGet('/files', {
              project_id: projectId,
              email: authStore.email,
            });

            if (Array.isArray(listRes)) {
              res = listRes.map((item: any) => {
                const filename = item.filename || '';
                const url = item.url?.startsWith('http')
                  ? item.url
                  : `${baseURL}${item.url || ''}`;
                return {
                  name: filename,
                  type: filename.split('.').pop() || '',
                  path: url,
                  relativePath: item.relativePath || filename,
                  isRemote: true,
                };
              });
            }
          }
        } catch (error) {
          console.warn('[Folder] Failed to fetch files from Brain:', error);
        }
      }

      const tree = buildFileTree(res);
      if (res && Array.isArray(res)) {
        const currentPaths = pathsFromFileList(res);
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
        const chatStoreSelectedFile =
          chatStore.tasks[activeTaskId]?.selectedFile;
        if (chatStoreSelectedFile) {
          const file = findMatchingFile(res, chatStoreSelectedFile);
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
            files: res || [],
          },
        ];
      });
    };

    const shouldFetch =
      lastFetchKey.current !== fetchKey ||
      (taskRunning && !hasFetchedRemote.current);
    if (shouldFetch) {
      lastFetchKey.current = fetchKey;
      hasFetchedRemote.current = true;
      void setFileList();
    }

    let pollTimer: ReturnType<typeof setInterval> | null = null;
    if (taskRunning) {
      pollTimer = setInterval(() => {
        void setFileList();
      }, 5000);
    }

    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fetchKey,
    taskRunning,
    taskAssigning,
    activeWorkspace,
    projectId,
    activeTaskId,
    authStore.email,
  ]);

  useEffect(() => {
    hasFetchedRemote.current = false;
  }, [projectId, activeTaskId]);

  const selectedFilePath =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.selectedFile?.path;

  useEffect(() => {
    if (!chatStore) return;
    const chatStoreSelectedFile =
      chatStore.tasks[chatStore.activeTaskId as string]?.selectedFile;
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
  }, [selectedFilePath, fileGroups, isShowSourceCode, chatStore?.activeTaskId]);

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
    });
  }, [selectedFile, workingFolderPath, t]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const _handleBack = () => {
    chatStore.setActiveWorkspace(chatStore.activeTaskId as string, 'workflow');
  };

  const handleOpenInIDE = async (ide: 'vscode' | 'cursor' | 'system') => {
    try {
      if (!authStore.email || !projectStore.activeProjectId) return;
      if (!electronAPI) return;
      const folderPath = await electronAPI.getProjectFolderPath(
        authStore.email,
        projectStore.activeProjectId
      );

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

  const folderHeaderTitle = workingFolderPath
    ? workingFolderBasename(workingFolderPath)
    : t('chat.agent-folder');
  const canOpenInExternalEditor =
    electronAPI?.getProjectFolderPath && electronAPI?.openInIDE;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* header */}
      <div className="gap-2 border-ds-border-neutral-subtle-default p-2 flex w-full shrink-0 items-center border-x-0 border-t-0 border-b-1 border-solid">
        <div className="min-w-0 flex max-w-[min(20rem,45%)] items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-pressed={isFileSidebarOpen}
            className="text-ds-icon-neutral-default-default shrink-0"
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
            className="min-w-0 text-body-sm font-semibold text-ds-text-neutral-default-default truncate leading-none"
            title={workingFolderPath ?? undefined}
          >
            {folderHeaderTitle}
          </span>
        </div>
        <div className="min-w-0 gap-2 ml-auto flex items-center">
          <div className="h-7 w-32 max-w-xs rounded-lg relative min-w-[10rem] shrink-0">
            <Search className="left-2 h-3.5 w-3.5 text-ds-text-brand-default-default pointer-events-none absolute top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={fileSearchQuery}
              onChange={(e) => setFileSearchQuery(e.target.value)}
              placeholder={t('chat.search')}
              className="h-7 rounded-lg border-ds-border-neutral-subtle-default py-0 pl-7 pr-2 text-sm focus:ring-ds-ring-brand-default-focus w-full border border-solid leading-none focus:ring-2 focus:ring-offset-0 focus:outline-none"
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
                className="border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default z-50"
              >
                <DropdownMenuItem
                  onClick={() => handleOpenInIDE('system')}
                  className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
                >
                  <FolderIcon className="size-4 shrink-0" aria-hidden />
                  {t('chat.open-in-file-manager')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleOpenInIDE('cursor')}
                  className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
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
                  className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
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

      <div className="min-h-0 flex flex-1 overflow-hidden">
        {/* sidebar */}
        {isFileSidebarOpen ? (
          <div className="w-64 border-ds-border-neutral-subtle-default flex h-full flex-shrink-0 flex-col border-y-0 border-r border-l-0 border-solid">
            <div className="h-8 px-1 flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    buttonContent="text"
                  >
                    <span className="min-w-0 font-bold truncate text-left">
                      {t('chat.files')}
                    </span>
                    <ChevronDown className="size-3.5 shrink-0 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="bottom"
                  align="start"
                  className="border-ds-border-neutral-default-default bg-ds-bg-neutral-strong-default z-50 min-w-[10rem]"
                >
                  <DropdownMenuRadioGroup
                    value={fileTreeScope}
                    onValueChange={(v) =>
                      setFileTreeScope(v === 'new' ? 'new' : 'all')
                    }
                  >
                    <DropdownMenuRadioItem
                      value="all"
                      className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
                    >
                      {t('folder.files-scope-all', {
                        defaultValue: 'All files',
                      })}
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem
                      value="new"
                      className="bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover cursor-pointer"
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
              <div className="pl-1.5 h-full">
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
        <div className="min-w-0 bg-ds-bg-neutral-subtle-default flex flex-1 flex-col overflow-hidden">
          {/* head */}
          {selectedFile && (
            <div className="h-8 gap-2 pl-3 pr-2 flex flex-shrink-0 items-center justify-between">
              <div
                onClick={() => {
                  // if file is remote, don't call reveal-in-folder
                  if (selectedFile.isRemote) {
                    void downloadFromUrl(selectedFile.path, selectedFile.name);
                    return;
                  }
                  ipcRenderer?.invoke('reveal-in-folder', selectedFile.path);
                }}
                className="min-w-0 flex flex-1 cursor-pointer items-center overflow-hidden"
              >
                <nav
                  className="scrollbar-always-visible min-w-0 gap-1 text-body-sm text-ds-text-neutral-muted-default flex max-w-full items-center overflow-x-auto"
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
                            className="h-3.5 w-3.5 text-ds-icon-neutral-muted-default shrink-0"
                            aria-hidden
                          />
                        ) : null}
                        <span
                          className={
                            isLast
                              ? 'font-bold text-ds-text-neutral-default-default shrink-0'
                              : 'font-normal shrink-0'
                          }
                        >
                          {segment}
                        </span>
                      </Fragment>
                    );
                  })}
                </nav>
              </div>
              <div className="gap-0.5 flex flex-shrink-0 items-center">
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
            className={`min-h-0 flex flex-1 flex-col ${
              selectedFile?.type === 'html' && !isShowSourceCode
                ? 'overflow-hidden'
                : 'scrollbar-always-visible overflow-y-auto'
            }`}
          >
            <div
              className={`flex flex-col ${
                selectedFile?.type === 'html' && !isShowSourceCode
                  ? 'min-h-0 h-full'
                  : 'py-2 pl-4 pr-2 min-h-full'
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
                      <HtmlView
                        selectedFile={selectedFile}
                        projectFiles={fileGroups[0]?.files || []}
                      />
                    )
                  ) : selectedFile.type === 'zip' ? (
                    <div className="text-ds-text-neutral-muted-default flex h-full w-full items-center justify-center">
                      <div className="text-center">
                        <FileText className="mb-4 h-12 w-12 text-ds-text-neutral-muted-default mx-auto" />
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
                    <pre className="font-mono text-sm text-ds-text-neutral-default-default overflow-auto break-words whitespace-pre-wrap">
                      {selectedFile.content}
                    </pre>
                  )
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <div className="text-center">
                      <div className="mb-4 h-8 w-8 animate-spin mx-auto rounded-full"></div>
                      <p className="text-body-sm text-ds-text-neutral-muted-default">
                        {t('chat.loading')}
                      </p>
                    </div>
                  </div>
                )
              ) : (
                <div className="text-ds-text-neutral-muted-default flex h-full w-full flex-1 items-center justify-center">
                  <div className="text-center">
                    <FileText className="mb-4 h-12 w-12 text-ds-text-neutral-muted-default mx-auto" />
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
    setSrc('');
    if (selectedFile.isRemote) {
      setSrc((selectedFile.content as string) || selectedFile.path);
      return;
    }
    // Use file:// source so Chromium can stream/seek large media files.
    setSrc(toFileUrl(selectedFile.path));
  }, [selectedFile]);

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
    <div className="gap-4 px-8 flex w-full flex-col items-center">
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
