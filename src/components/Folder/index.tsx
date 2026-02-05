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
  ChevronDown,
  ChevronLeft,
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

import { proxyFetchGet } from '@/api/http';
import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { injectFontStyles } from '@/lib/htmlFontStyles';
import { containsDangerousContent } from '@/lib/htmlSanitization';
import { useAuthStore } from '@/store/authStore';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ZoomControls } from './ZoomControls';

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

const FileTree: React.FC<FileTreeProps> = ({
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
              className={`text-primary flex w-full items-center justify-start rounded-xl bg-fill-fill-transparent p-2 text-left text-sm backdrop-blur-lg transition-colors hover:bg-fill-fill-transparent-active ${
                selectedFile?.path === child.path
                  ? 'bg-fill-fill-transparent-active'
                  : ''
              }`}
            >
              {child.isFolder && (
                <span className="flex h-4 w-4 items-center justify-center">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </span>
              )}
              {!child.isFolder && <span className="w-4" />}

              {child.isFolder ? (
                <FolderIcon className="mr-2 h-5 w-5 flex-shrink-0 text-yellow-600" />
              ) : child.icon ? (
                <child.icon className="mr-2 h-5 w-5 flex-shrink-0" />
              ) : (
                <FileText className="mr-2 h-5 w-5 flex-shrink-0" />
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

function downloadByBrowser(url: string) {
  window.ipcRenderer
    .invoke('download-file', url)
    .then((result) => {
      if (result.success) {
        console.log('download-file success:', result.path);
      } else {
        console.error('download-file error:', result.error);
      }
    })
    .catch((error) => {
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
        .catch((error) => {
          console.error('read-file-dataurl error:', error);
          setLoading(false);
        });
      return;
    }

    // all other files call open-file interface, the backend handles download and parsing
    window.ipcRenderer
      .invoke('open-file', file.type, file.path, isShowSourceCode)
      .then((res) => {
        setSelectedFile({ ...file, content: res });
        chatStore.setSelectedFile(chatStore.activeTaskId as string, file);
        setLoading(false);
      })
      .catch((error) => {
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

  // Reset hasFetchedRemote when activeTaskId changes
  useEffect(() => {
    hasFetchedRemote.current = false;
  }, [chatStore?.activeTaskId]);

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
          res = await proxyFetchGet('/api/chat/files', {
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chatStore?.tasks[chatStore?.activeTaskId as string]?.selectedFile?.path,
    fileGroups,
    isShowSourceCode,
    chatStore?.activeTaskId,
  ]);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const handleBack = () => {
    chatStore.setActiveWorkSpace(chatStore.activeTaskId as string, 'workflow');
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
                <Button
                  onClick={handleBack}
                  size="sm"
                  variant="ghost"
                  className={`flex items-center gap-2`}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-primary whitespace-nowrap text-xl font-bold">
                  {t('chat.agent-folder')}
                </span>
              </div>
            )}
            <div className="flex items-center">
              {!isCollapsed &&
                window.electronAPI?.getProjectFolderPath &&
                window.electronAPI?.openInIDE && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      try {
                        if (!authStore.email || !projectStore.activeProjectId)
                          return;
                        const folderPath =
                          await window.electronAPI.getProjectFolderPath(
                            authStore.email,
                            projectStore.activeProjectId
                          );
                        const result = await window.electronAPI.openInIDE(
                          folderPath,
                          authStore.preferredIDE
                        );
                        if (!result.success) {
                          toast.error(
                            result.error || t('chat.failed-to-open-folder')
                          );
                        }
                      } catch (error) {
                        console.error('Failed to open in IDE:', error);
                        toast.error(t('chat.failed-to-open-folder'));
                      }
                    }}
                    title={t('chat.open-in-ide')}
                  >
                    <SquareTerminal className="h-5 w-5 text-icon-secondary" />
                  </Button>
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
                    downloadByBrowser(selectedFile.path);
                    return;
                  }
                  window.ipcRenderer.invoke(
                    'reveal-in-folder',
                    selectedFile.path
                  );
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
          className={`min-h-0 flex-1 ${selectedFile?.type === 'html' && !isShowSourceCode ? 'overflow-hidden' : 'scrollbar overflow-y-auto'}`}
        >
          <div
            className={`h-full ${selectedFile?.type === 'html' && !isShowSourceCode ? '' : 'p-6'}`}
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
                ) : [
                    'png',
                    'jpg',
                    'jpeg',
                    'gif',
                    'bmp',
                    'webp',
                    'svg',
                  ].includes(selectedFile.type.toLowerCase()) ? (
                  <div className="flex h-full items-center justify-center">
                    <ImageLoader selectedFile={selectedFile} />
                  </div>
                ) : (
                  <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm text-text-primary">
                    {selectedFile.content}
                  </pre>
                )
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="text-center">
                    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
                    <p className="text-sm text-text-secondary">
                      {t('chat.loading')}
                    </p>
                  </div>
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center text-text-secondary">
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

function ImageLoader({ selectedFile }: { selectedFile: FileInfo }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    const filePath = selectedFile.isRemote
      ? (selectedFile.content as string)
      : selectedFile.path;

    window.electronAPI
      .readFileAsDataUrl(filePath)
      .then(setSrc)
      .catch((err: any) => console.error('Image load error:', err));
  }, [selectedFile]);

  return (
    <img
      src={src}
      alt={selectedFile.name}
      className="max-h-full max-w-full object-contain"
    />
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

      // Set the processed HTML with font styles - iframe sandbox provides security
      setProcessedHtml(injectFontStyles(processedHtmlContent));
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
