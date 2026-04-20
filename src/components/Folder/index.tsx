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

import { proxyFetchGet } from '@/api/http';
import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
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
        };

        const isRowSelected = selectedFile?.path === child.path;
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
              className={`rounded-lg px-2 py-1.5 min-w-0 gap-2 mb-1 hover:bg-ds-bg-neutral-subtle-hover flex w-full flex-row items-center justify-start text-left transition-colors ${
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
              <div className="border-ds-border-neutral-subtle-default ml-2 pl-2.5 border-l border-solid">
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

function downloadByBrowser(url: string) {
  window.ipcRenderer
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
    if (file.type === 'zip') {
      // if file is remote, don't call reveal-in-folder
      if (file.isRemote) {
        downloadByBrowser(file.path);
        return;
      }
      window.ipcRenderer.invoke('reveal-in-folder', file.path);
      return;
    }
    // Don't open folders in preview - they are handled by expand/collapse
    if (file.isFolder) {
      return;
    }
    setSelectedFile(file);
    setLoading(true);
    console.log('file', JSON.parse(JSON.stringify(file)));

    // For PDF files, use data URL instead of custom protocol
    if (file.type === 'pdf') {
      window.ipcRenderer
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
    window.ipcRenderer
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

    const nodeMap = new Map<string, FileTreeNode>();
    nodeMap.set('', root);

    const sortedFiles = [...files].sort((a, b) => {
      // Normalize paths to use forward slashes for cross-platform compatibility
      const normalizedPathA = (a.relativePath || '').replace(/\\/g, '/');
      const normalizedPathB = (b.relativePath || '').replace(/\\/g, '/');
      const depthA = normalizedPathA.split('/').filter(Boolean).length;
      const depthB = normalizedPathB.split('/').filter(Boolean).length;
      return depthA - depthB;
    });

    for (const file of sortedFiles) {
      // Normalize paths to use forward slashes for cross-platform compatibility
      const normalizedRelativePath = (file.relativePath || '').replace(
        /\\/g,
        '/'
      );
      const fullRelativePath = normalizedRelativePath
        ? `${normalizedRelativePath}/${file.name}`
        : file.name;

      const parentPath = normalizedRelativePath;
      const parentNode = nodeMap.get(parentPath) || root;

      const node: FileTreeNode = {
        name: file.name,
        path: file.path,
        type: file.type,
        isFolder: file.isFolder,
        icon: file.icon,
        children: file.isFolder ? [] : undefined,
        isRemote: file.isRemote,
      };

      parentNode.children!.push(node);

      if (file.isFolder) {
        nodeMap.set(fullRelativePath, node);
      }
    }

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
      if (typeof window.electronAPI?.getProjectFolderPath !== 'function') {
        setWorkingFolderPath(null);
        return;
      }
      try {
        const folderPath = await window.electronAPI.getProjectFolderPath(
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
  }, [authStore.email, projectStore.activeProjectId]);

  useEffect(() => {
    if (!chatStore) return;
    const setFileList = async () => {
      let res = null;
      res = await window.ipcRenderer.invoke(
        'get-project-file-list',
        authStore.email,
        projectStore.activeProjectId as string
      );
      let tree: any = null;
      if (
        (res && res.length > 0) ||
        import.meta.env.VITE_USE_LOCAL_PROXY === 'true'
      ) {
        tree = buildFileTree(res || []);
      } else {
        if (!hasFetchedRemote.current) {
          //TODO(file): rename endpoint to use project_id
          res = await proxyFetchGet('/api/v1/chat/files', {
            task_id: projectStore.activeProjectId as string,
          });
          hasFetchedRemote.current = true;
        }
        console.log('res', res);
        if (res) {
          res = res.map((item: any) => {
            return {
              name: item.filename,
              type: item.filename.split('.')[1],
              path: item.url,
              isRemote: true,
            };
          });
          tree = buildFileTree(res || []);
        }
      }
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
          chatStore.tasks[chatStore.activeTaskId as string]?.selectedFile;
        if (chatStoreSelectedFile) {
          console.log(res, chatStoreSelectedFile);
          const file = res.find(
            (item: any) => item.name === chatStoreSelectedFile.name
          );
          console.log('file', file);
          if (file && selectedFile?.path !== chatStoreSelectedFile?.path) {
            selectedFileChange(file as FileInfo, isShowSourceCode);
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
    setFileList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatStore?.tasks[chatStore?.activeTaskId as string]?.taskAssigning]);

  const selectedFilePath =
    chatStore?.tasks[chatStore?.activeTaskId as string]?.selectedFile?.path;

  useEffect(() => {
    if (!chatStore) return;
    const chatStoreSelectedFile =
      chatStore.tasks[chatStore.activeTaskId as string]?.selectedFile;
    if (chatStoreSelectedFile && fileGroups[0]?.files) {
      const file = fileGroups[0].files.find(
        (item: any) => item.path === chatStoreSelectedFile.path
      );
      if (file && selectedFile?.path !== chatStoreSelectedFile?.path) {
        selectedFileChange(file as FileInfo, isShowSourceCode);
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

  const handleBack = () => {
    chatStore.setActiveWorkspace(chatStore.activeTaskId as string, 'workflow');
  };

  const handleOpenInIDE = async (ide: 'vscode' | 'cursor' | 'system') => {
    try {
      if (!authStore.email || !projectStore.activeProjectId) return;
      const folderPath = await window.electronAPI.getProjectFolderPath(
        authStore.email,
        projectStore.activeProjectId
      );
      const result = await window.electronAPI.openInIDE(folderPath, ide);
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
    window.electronAPI?.getProjectFolderPath && window.electronAPI?.openInIDE;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* header */}
      <div className="gap-2 p-2 border-ds-border-neutral-subtle-default flex w-full shrink-0 items-center border-x-0 border-t-0 border-b-1 border-solid">
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
            className="text-ds-text-neutral-default-default text-body-sm min-w-0 font-semibold truncate leading-none"
            title={workingFolderPath ?? undefined}
          >
            {folderHeaderTitle}
          </span>
        </div>
        <div className="min-w-0 gap-2 ml-auto flex items-center">
          <div className="h-7 w-32 max-w-xs rounded-lg relative min-w-[10rem] shrink-0">
            <Search className="text-ds-text-brand-default-default left-2 h-3.5 w-3.5 pointer-events-none absolute top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={fileSearchQuery}
              onChange={(e) => setFileSearchQuery(e.target.value)}
              placeholder={t('chat.search')}
              className="border-ds-border-neutral-subtle-default focus:ring-ds-ring-brand-default-focus h-7 rounded-lg py-0 pl-7 pr-2 text-sm w-full border border-solid leading-none focus:ring-2 focus:ring-offset-0 focus:outline-none"
              aria-label={t('chat.search')}
            />
          </div>
          {canOpenInExternalEditor && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="primary"
                  size="sm"
                  className="h-7 gap-1 rounded-lg px-2 py-0 [&_svg]:size-3.5 shrink-0 items-center justify-center"
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
          <div className="border-ds-border-neutral-subtle-default w-64 flex h-full flex-shrink-0 flex-col border-y-0 border-r border-l-0 border-solid">
            <div className="px-1 h-8 flex items-center">
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
        <div className="min-w-0 bg-ds-bg-neutral-muted-default flex flex-1 flex-col overflow-hidden">
          {/* head */}
          {selectedFile && (
            <div className="pl-3 pr-2 h-8 gap-2 flex flex-shrink-0 items-center justify-between">
              <div
                onClick={() => {
                  // if file is remote, don't call reveal-in-folder
                  if (selectedFile.isRemote) {
                    downloadByBrowser(selectedFile.path);
                    return;
                  }
                  window.ipcRenderer.invoke(
                    'reveal-in-folder',
                    selectedFile.path
                  );
                }}
                className="min-w-0 flex flex-1 cursor-pointer items-center overflow-hidden"
              >
                <nav
                  className="text-ds-text-neutral-muted-default scrollbar-always-visible min-w-0 gap-1 text-body-sm flex max-w-full items-center overflow-x-auto"
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
                            className="text-ds-icon-neutral-muted-default h-3.5 w-3.5 shrink-0"
                            aria-hidden
                          />
                        ) : null}
                        <span
                          className={
                            isLast
                              ? 'text-ds-text-neutral-default-default font-bold shrink-0'
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
            className={`min-h-0 flex flex-1 flex-col ${
              selectedFile?.type === 'html' && !isShowSourceCode
                ? 'overflow-hidden'
                : 'scrollbar-always-visible overflow-y-auto'
            }`}
          >
            <div
              className={`flex min-h-full flex-col ${selectedFile?.type === 'html' && !isShowSourceCode ? '' : 'pl-4 py-2'} file-viewer-content`}
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

  useEffect(() => {
    const processHtml = async () => {
      if (!selectedFile.content) {
        setProcessedHtml('');
        return;
      }

      let html = selectedFile.content;

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

      // Skip image processing if file is remote (we can't resolve relative paths for remote files)
      if (selectedFile.isRemote) {
        setProcessedHtml(injectFontStyles(html));
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
            // Read image as data URL
            const dataUrl =
              await window.electronAPI.readFileAsDataUrl(imagePath);

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
          const cssContent = await window.ipcRenderer.invoke(
            'open-file',
            'css',
            cssFile.path,
            false
          );
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
          const jsContent = await window.ipcRenderer.invoke(
            'open-file',
            'js',
            jsFile.path,
            false
          );
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

    processHtml();
  }, [selectedFile, projectFiles]);

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
        className="min-h-0 bg-code-surface flex-1 overflow-hidden"
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
            sandbox="allow-scripts allow-forms"
            title={selectedFile.name}
            tabIndex={0}
            onLoad={() => iframeRef.current?.focus()}
          />
        </div>
      </div>
    </div>
  );
}
