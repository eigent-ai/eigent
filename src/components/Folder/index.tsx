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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  CodeXml,
  Download,
  FileText,
  Folder as FolderIcon,
  Search,
  SquareTerminal,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'];

function FileLoadingSpinner({ fileName }: { fileName?: string } = {}) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-4">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-border-subtle border-t-text-link" />
      <p className="text-sm text-text-secondary">
        {fileName ? (
          <>
            Loading{' '}
            <span className="font-medium text-text-primary">{fileName}</span>
            ...
          </>
        ) : (
          'Loading...'
        )}
      </p>
    </div>
  );
}

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

function isImageFile(file: FileTypeTarget) {
  return IMAGE_EXTENSIONS.includes(getFileType(file));
}
function isAudioFile(file: FileTypeTarget) {
  return AUDIO_EXTENSIONS.includes(getFileType(file));
}
function isVideoFile(file: FileTypeTarget) {
  return VIDEO_EXTENSIONS.includes(getFileType(file));
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
    <div className={level > 0 ? 'ml-4' : ''}>
      {node.children.map((child) => {
        const isExpanded = expandedFolders.has(child.path);
        const fileInfo: FileInfo = {
          name: child.name,
          path: child.path,
          type: child.type || '',
          isFolder: child.isFolder,
          icon: child.icon,
          isRemote: child.isRemote,
          relativePath: child.relativePath,
        };

        return (
          <div key={child.path}>
            <button
              onClick={() => {
                if (child.isFolder) {
                  onToggleFolder(child.path);
                } else {
                  onSelectFile(fileInfo);
                }
              }}
              className={`text-primary flex w-full items-center justify-start gap-2 rounded-xl bg-fill-fill-transparent p-2 text-left text-sm backdrop-blur-lg transition-colors hover:bg-fill-fill-transparent-active ${
                selectedFile?.path === child.path
                  ? 'bg-fill-fill-transparent-active'
                  : ''
              }`}
            >
              {child.isFolder ? (
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
              ) : (
                <span
                  className="flex h-4 w-4 flex-shrink-0 items-center justify-center"
                  aria-hidden
                />
              )}

              {child.isFolder ? (
                <FolderIcon className="h-5 w-5 flex-shrink-0 text-yellow-600" />
              ) : child.icon ? (
                <child.icon className="h-5 w-5 flex-shrink-0" />
              ) : (
                <FileText className="h-5 w-5 flex-shrink-0" />
              )}

              <span
                className={`truncate text-[13px] leading-5 ${
                  child.isFolder ? 'font-semibold' : 'font-medium'
                }`}
              >
                {child.name}
              </span>
            </button>

            {child.isFolder && isExpanded && child.children && (
              <FileTree
                node={child}
                level={level + 1}
                selectedFile={selectedFile}
                expandedFolders={expandedFolders}
                onToggleFolder={onToggleFolder}
                onSelectFile={onSelectFile}
                isShowSourceCode={isShowSourceCode}
              />
            )}
          </div>
        );
      })}
    </div>
  );
};

function downloadByBrowser(ipcRenderer: any, url: string) {
  const ipc = ipcRenderer;
  if (ipc?.invoke) {
    ipc
      .invoke('download-file', url)
      .then((result: { success?: boolean; path?: string; error?: string }) => {
        if (result?.success) {
          console.log('download-file success:', result.path);
        } else {
          console.error('download-file error:', result?.error);
        }
      })
      .catch((error: unknown) => {
        console.error('download-file error:', error);
      });
  } else {
    // Web mode: open in new tab for download
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export default function Folder({ data: _data }: { data?: Agent }) {
  //Get Chatstore for the active project's task
  const host = useHost();
  const { chatStore, projectStore } = useChatStoreAdapter();
  const authStore = useAuthStore();
  const { t } = useTranslation();
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [isShowSourceCode, setIsShowSourceCode] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
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
  const electronAPI = host?.electronAPI;
  const ipcRenderer = host?.ipcRenderer;

  const selectedFileChange = (file: FileInfo, isShowSourceCode?: boolean) => {
    const ipc = ipcRenderer;
    const isWebMode = !ipc?.invoke;

    if (file.type === 'zip') {
      if (file.isRemote) {
        downloadByBrowser(ipcRenderer, file.path);
        return;
      }
      ipc?.invoke('reveal-in-folder', file.path);
      return;
    }
    if (file.isFolder) return;

    setSelectedFile(file);
    setLoading(true);

    // Remote files (path is URL): use URL directly for display where possible
    if (file.isRemote && file.path?.startsWith('http')) {
      // Images/audio/video: use path (URL) directly, loaders will use it
      if (isImageFile(file) || isAudioFile(file) || isVideoFile(file)) {
        setSelectedFile({ ...file });
        chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
        setLoading(false);
        return;
      }
      // Other types (text, PDF, etc.): Electron uses IPC; Web fetches
      if (!isWebMode) {
        ipc
          ?.invoke('open-file', file.type, file.path, isShowSourceCode)
          ?.then((res: string) => {
            setSelectedFile({ ...file, content: res });
            chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
            setLoading(false);
          })
          ?.catch((error: unknown) => {
            console.error('open-file error:', error);
            setLoading(false);
          });
        return;
      }
      const loadRemoteContent = async () => {
        try {
          const resp = await fetch(file.path!);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const contentType = resp.headers.get('content-type') || '';
          let content: string;
          if (file.type === 'pdf' || contentType.includes('application/pdf')) {
            const blob = await resp.blob();
            content = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(r.result as string);
              r.onerror = reject;
              r.readAsDataURL(blob);
            });
          } else {
            content = await resp.text();
          }
          setSelectedFile({ ...file, content });
          chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
        } catch (e) {
          console.error('Failed to load remote file:', e);
        } finally {
          setLoading(false);
        }
      };
      loadRemoteContent();
      return;
    }

    // Electron: PDF and images (open-file reads binary as utf-8 and corrupts)
    if (file.type === 'pdf' || isImageFile(file)) {
      ipc
        ?.invoke('read-file-dataurl', file.path)
        ?.then((dataUrl: string) => {
          setSelectedFile({ ...file, content: dataUrl });
          chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
          setLoading(false);
        })
        ?.catch((error: unknown) => {
          console.error('read-file-dataurl error:', error);
          setLoading(false);
        });
      return;
    }

    // Audio/video: loaders use path or content
    if (isAudioFile(file) || isVideoFile(file)) {
      setSelectedFile({ ...file });
      chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
      setLoading(false);
      return;
    }

    // Electron: open-file
    ipc
      ?.invoke('open-file', file.type, file.path, isShowSourceCode)
      ?.then((res: string) => {
        setSelectedFile({ ...file, content: res });
        chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
        setLoading(false);
      })
      ?.catch((error: unknown) => {
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
        relativePath: file.relativePath,
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

  const activeTaskId = chatStore?.activeTaskId as string;
  const activeWorkspace = chatStore?.tasks[activeTaskId]?.activeWorkspace;
  const taskAssigning = chatStore?.tasks[activeTaskId]?.taskAssigning;
  // Reset state when activeTaskId changes (e.g., new project created)
  useEffect(() => {
    hasFetchedRemote.current = false;
    setSelectedFile(null);
    setFileTree({ name: 'root', path: '', children: [], isFolder: true });
    setFileGroups([{ folder: 'Reports', files: [] }]);
    setExpandedFolders(new Set());
  }, [activeTaskId]);

  // project_id: must match Brain path ~/eigent/{email}/project_{project_id}/task_{task_id}/
  const projectId = (projectStore.activeProjectId as string) || activeTaskId;

  const fetchKey = `${projectId}|${activeTaskId || ''}`;
  // Poll when task has agents that are running/pending (files may be generated)
  const taskRunning =
    !!taskAssigning?.length &&
    taskAssigning.some((a) => a.status === 'running' || a.status === 'pending');

  /**
   * Folder design: Frontend always fetches file list from Brain API.
   * - GET /files?project_id=&email=&task_id= → returns [{filename, url, relativePath}]
   * - Re-fetch when project/task changes (switch project) or periodically when task is running
   */
  useEffect(() => {
    if (!chatStore || !projectId || !authStore.email) return;

    const fetchFileList = async () => {
      let res: any[] = [];
      try {
        const baseURL = await getBaseURL();
        if (!baseURL) {
          console.warn('[Folder] Brain not connected, cannot fetch files');
          return;
        }
        // Omit task_id to list all files in project (all tasks); backend uses os.walk recursively
        const listRes = await fetchGet('/files', {
          project_id: projectId,
          email: authStore.email,
        });
        if (Array.isArray(listRes)) {
          res = listRes.map((item: any) => {
            const url = item.url?.startsWith('http')
              ? item.url
              : `${baseURL}${item.url || ''}`;
            return {
              name: item.filename,
              type: (item.filename || '').split('.').pop() || '',
              path: url,
              relativePath: item.relativePath || '',
              isRemote: true,
            };
          });
        }
      } catch (e) {
        console.warn('[Folder] Failed to fetch files from Brain:', e);
      }

      const tree = buildFileTree(res);
      setFileTree(tree);
      setFileGroups((prev) => {
        const chatStoreSelectedFile =
          chatStore.tasks[activeTaskId]?.selectedFile;
        if (chatStoreSelectedFile) {
          const file = res.find(
            (item: any) => item.name === chatStoreSelectedFile.name
          );
          if (file && selectedFile?.path !== chatStoreSelectedFile?.path) {
            selectedFileChange(file as FileInfo, isShowSourceCode);
          }
        }
        return [{ ...prev[0], files: res }];
      });
    };

    const shouldFetch =
      lastFetchKey.current !== fetchKey ||
      (taskRunning && !hasFetchedRemote.current);
    if (shouldFetch) {
      lastFetchKey.current = fetchKey;
      hasFetchedRemote.current = true;
      fetchFileList();
    }

    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    if (taskRunning) {
      pollTimer = setInterval(() => {
        fetchFileList();
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

  // Reset hasFetchedRemote when project/task changes so next effect run will fetch
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
      // Match: path (exact) > relativePath (chat path has task_xxx/filename) > name
      const chatPath = (chatStoreSelectedFile.path || '').replace(/\\/g, '/');
      const chatRel = chatPath.match(/(task_[^/]+\/.+)$/)?.[1] ?? null;
      const file = fileGroups[0].files.find(
        (item: any) =>
          item.path === chatStoreSelectedFile.path ||
          (chatRel !== null && item.relativePath === chatRel) ||
          item.name === chatStoreSelectedFile.name
      );
      if (file && selectedFile?.path !== file.path) {
        selectedFileChange(file as FileInfo, isShowSourceCode);
      }
    } else if (!chatStoreSelectedFile && selectedFile) {
      setSelectedFile(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFilePath, fileGroups, isShowSourceCode, chatStore?.activeTaskId]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const handleBack = () => {
    chatStore.setActiveWorkspace(chatStore.activeTaskId as string, 'workflow');
  };

  const handleOpenInIDE = async (ide: 'vscode' | 'cursor' | 'system') => {
    try {
      if (!authStore.email || !projectStore.activeProjectId) return;
      const folderPath = await electronAPI?.getProjectFolderPath(
        authStore.email,
        projectStore.activeProjectId
      );
      if (!folderPath) {
        toast.error(t('chat.failed-to-open-folder'));
        return;
      }
      const result = await electronAPI?.openInIDE(folderPath, ide);
      if (!result) {
        toast.error(t('chat.failed-to-open-folder'));
        return;
      }
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

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* fileList */}
      <div
        className={`${
          isCollapsed ? 'w-16' : 'w-64'
        } flex flex-shrink-0 flex-col border-[0px] border-r !border-solid border-border-subtle-strong border-r-border-subtle transition-all duration-300 ease-in-out`}
      >
        {/* head */}
        <div
          className={`flex-shrink-0 border-b border-border-subtle py-2 ${
            isCollapsed ? 'px-2' : 'pl-4 pr-2'
          }`}
        >
          <div className="flex items-center justify-between">
            {!isCollapsed && (
              <div className="flex items-center gap-2">
                <span className="text-body-base text-primary whitespace-nowrap font-bold">
                  {t('chat.agent-folder')}
                </span>
              </div>
            )}
            <div className="flex items-center">
              {!isCollapsed &&
                electronAPI?.getProjectFolderPath &&
                electronAPI?.openInIDE && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('chat.open-in-ide')}
                      >
                        <SquareTerminal className="h-5 w-5 text-icon-secondary" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="z-50 border-dropdown-border bg-dropdown-bg"
                    >
                      <DropdownMenuItem
                        onClick={() => handleOpenInIDE('vscode')}
                        className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                      >
                        {t('chat.open-in-vscode')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleOpenInIDE('cursor')}
                        className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                      >
                        {t('chat.open-in-cursor')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleOpenInIDE('system')}
                        className="cursor-pointer bg-dropdown-item-bg-default hover:bg-dropdown-item-bg-hover"
                      >
                        {t('chat.open-in-file-manager')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className={`${
                  isCollapsed ? 'w-full' : ''
                } flex items-center justify-center`}
                title={isCollapsed ? t('chat.open') : t('chat.close')}
              >
                <ChevronsLeft
                  className={`h-6 w-6 text-icon-secondary ${
                    isCollapsed ? 'rotate-180' : ''
                  } transition-transform ease-in-out`}
                />
              </Button>
            </div>
          </div>
        </div>

        {/* Search Input*/}
        {!isCollapsed && (
          <div className="flex-shrink-0 border-b border-border-subtle px-2">
            <div className="relative">
              <Search className="text-primary absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform" />
              <input
                type="text"
                placeholder={t('chat.search')}
                className="w-full rounded-md border border-solid border-border-subtle py-2 pl-9 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-text-link"
              />
            </div>
          </div>
        )}

        {/* fileList */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!isCollapsed ? (
            <div className="p-2">
              <div className="mb-2">
                <div className="text-primary px-2 py-1 text-[10px] font-bold leading-4">
                  {t('chat.files')}
                </div>
                <FileTree
                  node={fileTree}
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
          ) : (
            // Display simplified file icons when collapsed
            <div className="space-y-2 p-2">
              {fileGroups.map((group) =>
                group.files.map((file) => (
                  <button
                    key={file.path}
                    onClick={() => selectedFileChange(file, isShowSourceCode)}
                    className={`flex w-full items-center justify-center rounded-md p-2 transition-colors hover:bg-fill-fill-primary-hover ${
                      selectedFile?.name === file.name
                        ? 'bg-surface-information text-text-information'
                        : 'text-text-secondary'
                    }`}
                    title={file.name}
                  >
                    {file.icon ? (
                      <file.icon className="h-4 w-4" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* head */}
        {selectedFile && (
          <div className="flex-shrink-0 border-b border-border-subtle px-4 py-2">
            <div className="flex h-[30px] items-center justify-between gap-2">
              <div
                onClick={() => {
                  // if file is remote, don't call reveal-in-folder
                  if (selectedFile.isRemote) {
                    downloadByBrowser(ipcRenderer, selectedFile.path);
                    return;
                  }
                  ipcRenderer?.invoke('reveal-in-folder', selectedFile.path);
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden"
              >
                <span className="text-primary block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-medium leading-[22px]">
                  {selectedFile.name}
                </span>
                <Button size="icon" variant="ghost">
                  <Download className="h-4 w-4 text-icon-secondary" />
                </Button>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                onClick={() => isShowSourceCodeChange()}
              >
                <CodeXml className="h-4 w-4 text-icon-secondary" />
              </Button>
            </div>
          </div>
        )}

        {/* content */}
        <div
          className={`flex min-h-0 flex-1 flex-col ${selectedFile?.type === 'html' && !isShowSourceCode ? 'overflow-hidden' : 'scrollbar overflow-y-auto'}`}
        >
          <div
            className={`flex min-h-full flex-col ${selectedFile?.type === 'html' && !isShowSourceCode ? '' : 'p-6'} file-viewer-content`}
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
                  <div className="flex h-full items-center justify-center text-text-secondary">
                    <div className="text-center">
                      <FileText className="mx-auto mb-4 h-12 w-12 text-text-tertiary" />
                      <p className="text-sm">
                        {t('folder.zip-file-is-not-supported-yet')}
                      </p>
                    </div>
                  </div>
                ) : isAudioFile(selectedFile) ? (
                  <div className="flex h-full items-center justify-center">
                    <AudioLoader selectedFile={selectedFile} />
                  </div>
                ) : isVideoFile(selectedFile) ? (
                  <div className="flex h-full items-center justify-center">
                    <VideoLoader selectedFile={selectedFile} />
                  </div>
                ) : isImageFile(selectedFile) ? (
                  <div className="flex h-full items-center justify-center">
                    <ImageLoader
                      key={selectedFile.path ?? selectedFile.name}
                      selectedFile={selectedFile}
                    />
                  </div>
                ) : (
                  <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-sm text-text-primary">
                    {selectedFile.content}
                  </pre>
                )
              ) : (
                <FileLoadingSpinner fileName={selectedFile?.name} />
              )
            ) : (
              <div className="flex flex-1 items-center justify-center text-text-secondary">
                <div className="text-center">
                  <FileText className="mx-auto mb-4 h-12 w-12 text-text-tertiary" />
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
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    setSrc('');
    setLoadError(false);

    if (selectedFile.isRemote) {
      setSrc((selectedFile.content as string) || selectedFile.path);
      return;
    }
    setSrc(toFileUrl(selectedFile.path));
  }, [selectedFile]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-2 text-text-secondary">
        <p className="text-sm">{selectedFile.name}</p>
        <p className="text-xs text-text-tertiary">
          Failed to load image. Try selecting again.
        </p>
      </div>
    );
  }

  if (!src) {
    return <FileLoadingSpinner fileName={selectedFile.name} />;
  }

  return (
    <img
      src={src}
      alt={selectedFile.name}
      className="max-h-full max-w-full object-contain"
      onError={() => setLoadError(true)}
    />
  );
}

function AudioLoader({ selectedFile }: { selectedFile: FileInfo }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    setSrc('');
    if (selectedFile.isRemote) {
      setSrc(selectedFile.content || selectedFile.path || '');
      return;
    }
    // Use file:// source so Chromium can stream/seek large media files.
    setSrc(toFileUrl(selectedFile.path));
  }, [selectedFile]);

  if (!src) {
    return <FileLoadingSpinner fileName={selectedFile.name} />;
  }

  return (
    <div className="flex w-full flex-col items-center gap-4 px-8">
      <p className="text-sm font-medium text-text-primary">
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
      setSrc(selectedFile.content || selectedFile.path || '');
      return;
    }
    // Use file:// source so Chromium can stream/seek large media files.
    setSrc(toFileUrl(selectedFile.path));
  }, [selectedFile]);

  if (!src) {
    return <FileLoadingSpinner fileName={selectedFile.name} />;
  }

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
    normalizedUrl.startsWith('#')
  );
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

    return `${url.origin}/files/preview/${encodeURIComponent(email)}/${encodeURIComponent(projectId)}/${encodePathSegments(relativePath)}`;
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
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const ipcRenderer = host?.ipcRenderer;
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

      // Remote HTML needs URL rewriting so relative assets resolve back to Brain.
      if (selectedFile.isRemote) {
        const previewBaseHref = getRemotePreviewBaseHref(selectedFile);
        const rewrittenHtml = rewriteRemoteHtmlReferences(
          html,
          selectedFile,
          projectFiles
        );
        setProcessedHtml(
          injectFontStyles(
            deferInlineScriptsUntilLoad(
              previewBaseHref
                ? injectBaseHref(rewrittenHtml, previewBaseHref)
                : rewrittenHtml
            )
          )
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
            // Read image as data URL
            const dataUrl = await electronAPI?.readFileAsDataUrl(imagePath);
            if (!dataUrl) {
              return { original: imgTag, processed: imgTag };
            }

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
          const cssContent = await ipcRenderer?.invoke(
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
          const jsContent = await ipcRenderer?.invoke(
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

  if (selectedFile.content && !processedHtml) {
    return <FileLoadingSpinner fileName={selectedFile.name} />;
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
