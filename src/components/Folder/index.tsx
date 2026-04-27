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
import { useHost } from '@/host';
import {
  deferInlineScriptsUntilLoad,
  injectFontStyles,
} from '@/lib/htmlFontStyles';
import { containsDangerousContent } from '@/lib/htmlSanitization';
import { useAuthStore } from '@/store/authStore';
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
              <div className="ml-2 border-l border-solid border-ds-border-neutral-subtle-default pl-2.5">
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

type DownloadFileResult =
  | { success: true; path: string }
  | { success: false; error: string };

function downloadByBrowser(url: string, ipcRenderer?: any) {
  if (!ipcRenderer) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  ipcRenderer
    .invoke('download-file', url)
    .then((result: DownloadFileResult) => {
      if (result.success) {
        console.log('download-file success:', result.path);
      } else {
        console.error('download-file error:', result.error);
      }
    })
    .catch((error: unknown) => {
      console.error('download-file error:', error);
    });
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
        downloadByBrowser(file.path, ipcRenderer);
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
            title={workingFolderPath ?? undefined}
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
                    downloadByBrowser(selectedFile.path, ipcRenderer);
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
                <Button size="icon" variant="ghost" type="button">
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

function hasScriptSrcAttribute(attrs: string): boolean {
  return /(?:^|\s)src\s*=/.test(attrs.toLowerCase());
}

function isClassicScriptAttribute(attrs: string): boolean {
  const typeMatch = attrs.match(
    /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
  );
  if (!typeMatch) return true;

  const rawType = (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? '').trim();
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
  let repairedHtml = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (fullTag, attrs: string, content: string) => {
      if (!content.includes('{{') && !content.includes('}}')) {
        return fullTag;
      }
      return `<style${attrs}>${normalizeGeneratedDoubleBraces(content)}</style>`;
    }
  );

  repairedHtml = repairedHtml.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (fullTag, attrs: string, content: string) => {
      if (
        hasScriptSrcAttribute(attrs) ||
        !isClassicScriptAttribute(attrs) ||
        (!content.includes('{{') && !content.includes('}}'))
      ) {
        return fullTag;
      }

      const normalizedContent = normalizeGeneratedDoubleBraces(content);
      if (
        !canParseClassicScript(content) &&
        canParseClassicScript(normalizedContent)
      ) {
        return `<script${attrs}>${normalizedContent}</script>`;
      }

      return fullTag;
    }
  );

  return repairedHtml;
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
    if (!email || !projectId) {
      return undefined;
    }

    const filesIndex = url.pathname.indexOf('/files/stream');
    const routePrefix =
      filesIndex >= 0 ? url.pathname.substring(0, filesIndex) : '';

    return `${url.origin}${routePrefix}/files/preview/${encodeURIComponent(email)}/${encodeURIComponent(projectId)}/${encodePathSegments(relativePath)}`;
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

      // Parse HTML to find referenced JS and CSS files via relative paths
      const scriptSrcRegex = /<script[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
      const linkHrefRegex =
        /<link[^>]*href\s*=\s*["']([^"']+\.css)["'][^>]*>/gi;

      const referencedPaths: Set<string> = new Set();

      // Helper to extract and resolve paths
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

      // Extract script sources
      let scriptMatch;
      while ((scriptMatch = scriptSrcRegex.exec(html)) !== null) {
        addReferencedPath(scriptMatch[1]);
      }

      // Extract CSS link hrefs
      let linkMatch;
      while ((linkMatch = linkHrefRegex.exec(html)) !== null) {
        addReferencedPath(linkMatch[1]);
      }

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
        setProcessedHtml(
          injectFontStyles(deferInlineScriptsUntilLoad(htmlWithInlineImages))
        );
        return;
      }

      // Find all img tags with relative paths (match various formats)
      const imgRegex = /<img\s+([^>]*?)(?:\s*\/\s*>|>)/gi;
      const matches = Array.from(html.matchAll(imgRegex));

      // Process each img tag
      const processedImages = await Promise.all(
        matches.map(async (match) => {
          const fullMatch = match[0];
          const attributes = match[1];
          // Reconstruct the img tag to handle both <img ...> and <img ... />
          const imgTag = fullMatch;

          // Extract src attribute
          const srcMatch = attributes.match(/src\s*=\s*["']([^"']+)["']/i);
          if (!srcMatch) return { original: imgTag, processed: imgTag };

          const src = srcMatch[1];

          // Skip if src is already absolute (http, https, data:, localfile:)
          if (
            src.startsWith('http://') ||
            src.startsWith('https://') ||
            src.startsWith('data:') ||
            src.startsWith('localfile://')
          ) {
            return { original: imgTag, processed: imgTag };
          }

          // Build full path for relative image
          const imagePath = joinPath(htmlDir, src);

          try {
            if (!electronAPI?.readFileAsDataUrl) {
              return { original: imgTag, processed: imgTag };
            }
            // Read image as data URL
            const dataUrl = await electronAPI.readFileAsDataUrl(imagePath);

            // Replace src with data URL
            const newAttributes = attributes.replace(
              /src\s*=\s*["'][^"']+["']/i,
              `src="${dataUrl}"`
            );
            // Preserve the original tag format (self-closing or not)
            const isSelfClosing = imgTag.trim().endsWith('/>');
            const processedTag = isSelfClosing
              ? `<img ${newAttributes} />`
              : `<img ${newAttributes}>`;

            return { original: imgTag, processed: processedTag };
          } catch (error) {
            console.error(`Failed to load image: ${imagePath}`, error);
            // Keep original tag if image loading fails
            return { original: imgTag, processed: imgTag };
          }
        })
      );

      // Replace all img tags in HTML
      let processedHtmlContent = html;
      processedImages.forEach(({ original, processed }) => {
        processedHtmlContent = processedHtmlContent.replace(
          original,
          processed
        );
      });

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
            // Replace external script tag with inline script
            const scriptRegex = new RegExp(
              `<script[^>]*src=["'](?:[^"']*[/\\\\])?${jsFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
              'gi'
            );
            const inlineScriptTag = `<script data-source="${jsFile.name}">${jsContent}</script>`;
            processedHtmlContent = processedHtmlContent.replace(
              scriptRegex,
              inlineScriptTag
            );
          }
        } catch (error) {
          console.error(`Failed to load JS file: ${jsFile.path}`, error);
        }
      }

      // Final check for dangerous content after all processing (including injected JS)
      if (containsDangerousContent(processedHtmlContent)) {
        setProcessedHtml('');
        return;
      }

      // Defer inline scripts until load when document has external scripts (e.g. Chart.js),
      const htmlWithDeferredScripts =
        deferInlineScriptsUntilLoad(processedHtmlContent);

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
