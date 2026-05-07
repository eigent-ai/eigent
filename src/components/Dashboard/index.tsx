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

import { fetchGet, getBaseURL } from '@/api/http';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useProjectStore } from '@/store/projectStore';
import { FileCode, LayoutDashboard, Plus, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type FileInfo, HtmlView } from './HtmlView';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DashboardTab {
  id: string;
  file: FileInfo;
  projectFiles: FileInfo[];
}

// ─── Custom compact tab bar (28 px tall, matching icon buttons) ──────────────

function ArtifactTabList({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-7 gap-0.5 rounded-lg bg-ds-bg-neutral-strong-default p-0.5 inline-flex items-center">
      {children}
    </div>
  );
}

function ArtifactTab({
  id,
  name,
  active,
  onActivate,
  onClose,
}: {
  id: string;
  name: string;
  active: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onActivate(id)}
      className={cn(
        'group h-6 gap-1 rounded-md px-2 text-xs font-medium focus-visible:ring-ds-border-neutral-default-default relative inline-flex shrink-0 items-center transition-colors focus-visible:ring-2 focus-visible:outline-none',
        active
          ? 'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default shadow-sm'
          : 'text-ds-text-neutral-muted-default hover:bg-ds-bg-neutral-subtle-hover hover:text-ds-text-neutral-default-default'
      )}
    >
      {/* Leading: FileCode by default, X on hover */}
      <span className="h-3.5 w-3.5 relative flex shrink-0 items-center justify-center">
        <FileCode
          className="h-3.5 w-3.5 transition-opacity group-hover:opacity-0"
          aria-hidden
        />
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Close ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onClose(id);
            }
          }}
          className="inset-0 absolute flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </span>
      </span>
      <span className="max-w-[120px] truncate leading-none">{name}</span>
    </button>
  );
}

// ─── Main Dashboard component ────────────────────────────────────────────────

export default function Dashboard() {
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const authStore = useAuthStore();
  const projectStore = useProjectStore();
  const projectId = projectStore.activeProjectId;

  const [htmlFiles, setHtmlFiles] = useState<FileInfo[]>([]);
  const [allFiles, setAllFiles] = useState<FileInfo[]>([]);
  const [openTabs, setOpenTabs] = useState<DashboardTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // Incrementing this sends a postMessage refresh to the active iframe (Model B).
  const [liveRefreshSignal, setLiveRefreshSignal] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const autoOpenedRef = useRef(false);

  const fetchFileList = useCallback(async () => {
    if (!authStore.email || !projectId) return [] as FileInfo[];

    let files: FileInfo[] = [];

    if (ipcRenderer) {
      try {
        const localFiles = await ipcRenderer.invoke(
          'get-project-file-list',
          authStore.email,
          projectId
        );
        if (Array.isArray(localFiles)) files = localFiles;
      } catch {
        /* fall through */
      }
    }

    if (
      !files.length ||
      !ipcRenderer ||
      import.meta.env.VITE_USE_LOCAL_PROXY === 'true'
    ) {
      try {
        const baseURL = await getBaseURL();
        if (baseURL) {
          const listRes = await fetchGet('/files', {
            project_id: projectId,
            email: authStore.email,
          });
          if (Array.isArray(listRes)) {
            files = listRes.map((item: Record<string, string>) => {
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
              } satisfies FileInfo;
            });
          }
        }
      } catch {
        /* ignore */
      }
    }

    setAllFiles(files);
    const html = files.filter(
      (f) => !f.isFolder && f.type?.toLowerCase() === 'html'
    );
    setHtmlFiles(html);
    return html;
  }, [authStore.email, projectId, ipcRenderer]);

  const readFileContent = useCallback(
    async (file: FileInfo): Promise<string> => {
      if (file.isRemote) {
        const res = await fetch(file.path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      }
      if (ipcRenderer) {
        return (await ipcRenderer.invoke(
          'open-file',
          'html',
          file.path,
          false
        )) as string;
      }
      return '';
    },
    [ipcRenderer]
  );

  const openFile = useCallback(
    async (file: FileInfo, latestAllFiles?: FileInfo[]) => {
      const existing = openTabs.find((t) => t.file.path === file.path);
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }

      const content = await readFileContent(file);
      const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setOpenTabs((prev) => [
        ...prev,
        {
          id,
          file: { ...file, content },
          projectFiles: latestAllFiles ?? allFiles,
        },
      ]);
      setActiveTabId(id);
    },
    [openTabs, readFileContent, allFiles]
  );

  useEffect(() => {
    const init = async () => {
      const html = await fetchFileList();
      if (!autoOpenedRef.current && html.length === 1) {
        autoOpenedRef.current = true;
        await openFile(html[0]);
      }
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const closeTab = useCallback((tabId: string) => {
    setOpenTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === tabId);
      const next = prev.filter((t) => t.id !== tabId);
      setActiveTabId((cur) => {
        if (cur === tabId)
          return next[Math.min(idx, next.length - 1)]?.id ?? null;
        return cur;
      });
      return next;
    });
  }, []);

  // Model B refresh: re-read file for any updated content, then postMessage
  // the iframe to trigger its own in-page data refresh via window.__eigentRefresh().
  const handleRefresh = useCallback(async () => {
    if (!activeTabId) return;
    const tab = openTabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    setIsRefreshing(true);
    try {
      const [content, latestFiles] = await Promise.all([
        readFileContent(tab.file),
        fetchFileList(),
      ]);
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabId
            ? {
                ...t,
                file: { ...t.file, content },
                projectFiles: latestFiles ?? allFiles,
              }
            : t
        )
      );
      // Signal the iframe to call window.__eigentRefresh() for live data pull.
      setLiveRefreshSignal((n) => n + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [activeTabId, openTabs, readFileContent, fetchFileList, allFiles]);

  const activeTab = openTabs.find((t) => t.id === activeTabId) ?? null;
  const alreadyOpenPaths = new Set(openTabs.map((t) => t.file.path));
  const availableToAdd = htmlFiles.filter((f) => !alreadyOpenPaths.has(f.path));

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* ── Single header — matches inbox (Folder) page style exactly ── */}
      <div className="gap-2 border-ds-border-neutral-subtle-default p-2 flex w-full shrink-0 items-center border-x-0 border-t-0 border-b-1 border-solid">
        {/* Left: icon + title */}
        <div className="gap-1.5 flex shrink-0 items-center">
          <LayoutDashboard
            className="h-3.5 w-3.5 text-ds-icon-neutral-default-default shrink-0"
            aria-hidden
          />
          <span className="text-body-sm font-semibold text-ds-text-neutral-default-default leading-none">
            Live Artifacts
          </span>
        </div>

        {/* Center: compact artifact tabs + add button */}
        <div className="min-w-0 gap-1.5 flex flex-1 items-center justify-center overflow-x-auto">
          {openTabs.length > 0 && (
            <ArtifactTabList>
              {openTabs.map((tab) => (
                <ArtifactTab
                  key={tab.id}
                  id={tab.id}
                  name={tab.file.name}
                  active={tab.id === activeTabId}
                  onActivate={setActiveTabId}
                  onClose={closeTab}
                />
              ))}
            </ArtifactTabList>
          )}

          <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                aria-label="Open artifact file"
                className="h-7 w-7 text-ds-icon-neutral-default-default shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="min-w-[220px]">
              {availableToAdd.length === 0 ? (
                <div className="text-ds-text-neutral-muted-default px-3 py-2 text-xs">
                  {htmlFiles.length === 0
                    ? 'No HTML files in project folder yet'
                    : 'All files are already open'}
                </div>
              ) : (
                availableToAdd.map((file) => (
                  <DropdownMenuItem
                    key={file.path}
                    onClick={() => void openFile(file)}
                    className="gap-2"
                  >
                    <FileCode className="h-3.5 w-3.5 text-ds-icon-neutral-muted-default shrink-0" />
                    <span className="text-xs truncate">{file.name}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Right: Refresh */}
        <div className="gap-1 flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            aria-label="Refresh live artifact"
            disabled={!activeTabId || isRefreshing}
            onClick={() => void handleRefresh()}
            className="h-7 w-7 text-ds-icon-neutral-default-default shrink-0"
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')}
            />
          </Button>
        </div>
      </div>

      {/* ── Content row: main area + slide-in panel side by side ── */}
      <div className="min-h-0 flex flex-1 flex-row overflow-hidden">
        {/* Main content — shrinks when panel opens */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {activeTab ? (
            <HtmlView
              key={activeTab.id}
              selectedFile={activeTab.file}
              projectFiles={activeTab.projectFiles}
              liveRefreshSignal={liveRefreshSignal}
              projectId={projectId ?? undefined}
            />
          ) : (
            <EmptyState
              hasHtmlFiles={htmlFiles.length > 0}
              onOpenFile={() => setAddMenuOpen(true)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  hasHtmlFiles,
  onOpenFile,
}: {
  hasHtmlFiles: boolean;
  onOpenFile: () => void;
}) {
  return (
    <div className="gap-4 px-8 flex h-full w-full flex-col items-center justify-center text-center">
      <div className="rounded-2xl bg-ds-bg-neutral-subtle-default p-5">
        <LayoutDashboard className="h-10 w-10 text-ds-icon-neutral-muted-default" />
      </div>
      <div className="max-w-xs space-y-1.5">
        <p className="text-sm font-medium text-ds-text-neutral-default-default">
          {hasHtmlFiles ? 'Open a live artifact' : 'No live artifacts yet'}
        </p>
        <p className="text-xs leading-relaxed text-ds-text-neutral-muted-default">
          {hasHtmlFiles
            ? 'Click + to open an HTML file from your project folder.'
            : 'Ask the workforce to build a dashboard HTML file. Once generated it will appear here.'}
        </p>
      </div>
      {hasHtmlFiles && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenFile}
          className="gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Open file
        </Button>
      )}
    </div>
  );
}
