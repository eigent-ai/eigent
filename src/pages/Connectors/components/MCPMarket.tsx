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

import { proxyFetchDelete, proxyFetchGet, proxyFetchPost } from '@/api/http';
import githubIcon from '@/assets/github.svg';
import AnthropicIcon from '@/assets/mcp/Anthropic.svg?url';
import CamelIcon from '@/assets/mcp/Camel.svg?url';
import CommunityIcon from '@/assets/mcp/Community.svg?url';
import OfficialIcon from '@/assets/mcp/Official.svg?url';
import SearchInput from '@/components/SearchInput';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useAuthStore } from '@/store/authStore';
import { ChevronLeft, CircleAlert, Store } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MCPEnvDialog } from './MCPEnvDialog';
interface MCPItem {
  id: number;
  name: string;
  key: string;
  description: string;
  status: number | string;
  category?: { name: string };
  home_page?: string;
  install_command?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  };
  homepage?: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}
// map category name to svg file name
const categoryIconMap: Record<string, string> = {
  anthropic: 'Anthropic',
  community: 'Community',
  official: 'Official',
  camel: 'Camel',
};

// load all svg files
const svgIcons: Record<string, string> = {
  Anthropic: AnthropicIcon,
  Community: CommunityIcon,
  Official: OfficialIcon,
  Camel: CamelIcon,
};

type MCPMarketProps = {
  onBack?: () => void;
  keyword?: string;
};

export default function MCPMarket({
  onBack,
  keyword: externalKeyword,
}: MCPMarketProps) {
  const { t } = useTranslation();
  const { checkAgentTool } = useAuthStore();
  const [items, setItems] = useState<MCPItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [keyword, setKeyword] = useState('');
  const effectiveKeyword =
    externalKeyword !== undefined ? externalKeyword : keyword;
  const debouncedKeyword = useDebounce(effectiveKeyword, 400);
  const loader = useRef<HTMLDivElement | null>(null);
  const [installing, setInstalling] = useState<{ [id: number]: boolean }>({});
  const [installed, setInstalled] = useState<{ [id: number]: boolean }>({});
  const [installedIds, setInstalledIds] = useState<number[]>([]);
  const [mcpCategory, setMcpCategory] = useState<
    { id: number; name: string }[]
  >([]);

  // environment variable configuration
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [activeMcp, setActiveMcp] = useState<MCPItem | null>(null);

  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const effectiveCategoryId = categoryId;
  const [userInstallMcp, setUserInstallMcp] = useState<any | undefined>([]);
  // get installed MCP list
  useEffect(() => {
    proxyFetchGet('/api/mcp/users').then((res) => {
      let ids: number[] = [];
      if (Array.isArray(res)) {
        setUserInstallMcp(res);
        ids = res.map((item: any) => item.mcp_id);
      } else if (Array.isArray(res.items)) {
        setUserInstallMcp(res.items);
        ids = res.items.map((item: any) => item.mcp_id);
      }
      setInstalledIds(ids);
    });
  }, []);

  // get MCP categories
  useEffect(() => {
    proxyFetchGet('/api/mcp/categories').then((res) => {
      if (Array.isArray(res)) {
        setMcpCategory(res);
      }
    });
  }, []);

  // load data
  const loadData = useCallback(
    async (pageNum: number, kw: string, catId?: number, pageSize = 20) => {
      setIsLoading(true);
      setError('');
      try {
        const params: any = { page: pageNum, size: pageSize, keyword: kw };
        if (catId) params.category_id = catId;
        const res = await proxyFetchGet('/api/mcps', params);
        if (res && Array.isArray(res.items)) {
          // frontend deduplication
          const all: MCPItem[] =
            pageNum === 1 ? res.items : [...items, ...res.items];
          const unique: MCPItem[] = Array.from(
            new Map(all.map((i: MCPItem) => [i.id, i])).values()
          );
          setItems(unique);
          setHasMore(res.items.length === pageSize);
        } else {
          if (pageNum === 1) setItems([]);
          setHasMore(false);
        }
      } catch (err: any) {
        setError(err?.message || 'Load failed');
      } finally {
        setIsLoading(false);
      }
    },
    [items]
  );

  useEffect(() => {
    setPage(1);
    loadData(1, debouncedKeyword, effectiveCategoryId);
    // eslint-disable-next-line
  }, [debouncedKeyword, effectiveCategoryId]);

  useEffect(() => {
    if (page > 1) loadData(page, debouncedKeyword, effectiveCategoryId);
    // eslint-disable-next-line
  }, [page]);

  useEffect(() => {
    if (!hasMore || isLoading) return;
    const node = loader.current;
    if (!node) return;
    const observer = new window.IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage((p) => (isLoading || !hasMore ? p : p + 1));
        }
      },
      { root: null, rootMargin: '0px', threshold: 0.1 }
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasMore, isLoading]);

  const checkEnv = (id: number) => {
    const mcp = items.find((mcp) => mcp.id === id);
    if (mcp && Object.keys(mcp?.install_command?.env || {}).length > 0) {
      setActiveMcp(mcp);
      setShowEnvConfig(true);
    } else {
      installMcp(id);
    }
  };
  const onConnect = (mcp: MCPItem) => {
    console.log(mcp);
    setItems((prev) =>
      prev.map((item) => (item.id === mcp.id ? { ...item, ...mcp } : item))
    );
    installMcp(mcp.id);
    onClose();
  };
  const onClose = () => {
    setShowEnvConfig(false);
    setActiveMcp(null);
  };
  const installMcp = async (id: number) => {
    setInstalling((prev) => ({ ...prev, [id]: true }));
    try {
      const mcpItem = items.find((item) => item.id === id);
      const res = await proxyFetchPost('/api/mcp/install?mcp_id=' + id);
      if (res) {
        console.log(res);
        setUserInstallMcp((prev: any) => [...prev, res]);
      }
      setInstalled((prev) => ({ ...prev, [id]: true }));
      setInstalledIds((prev) => [...prev, id]);
      // notify main process
      if (window.ipcRenderer && mcpItem) {
        await window.ipcRenderer.invoke(
          'mcp-install',
          mcpItem.key,
          mcpItem.install_command
        );
      }
    } catch (e) {
      console.error('Error installing MCP:', e);
    } finally {
      setInstalling((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleBack = () => {
    if (onBack) onBack();
    else window.history.back();
  };

  const handleDelete = async (deleteTarget: MCPItem) => {
    if (!deleteTarget) return;
    try {
      checkAgentTool(deleteTarget.name);
      console.log(userInstallMcp, deleteTarget);
      const userMcpRecord = userInstallMcp.find(
        (item: any) => item.mcp_id === deleteTarget.id
      );
      const id = userMcpRecord?.id;
      if (id === undefined || id === null) {
        console.warn(
          'No matching user MCP record found for delete target:',
          deleteTarget
        );
        return;
      }
      console.log('deleteTarget', deleteTarget);
      await proxyFetchDelete(`/api/mcp/users/${id}`);
      // notify main process
      if (window.ipcRenderer) {
        await window.ipcRenderer.invoke('mcp-remove', deleteTarget.key);
      }
      setInstalledIds((prev) =>
        prev.filter((item) => item !== deleteTarget.id)
      );
      setInstalled((prev) => ({ ...prev, [deleteTarget.id]: false }));
      loadData(1, debouncedKeyword, categoryId, page * 20);
    } catch (e) {
      console.log(e);
    }
  };
  return (
    <div className="flex h-full flex-col items-center">
      {externalKeyword === undefined && (
        <>
          <div className="text-body sticky top-0 z-[20] mb-0 flex w-full max-w-4xl items-center justify-between py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="mr-2"
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <span className="text-base font-bold leading-12 text-text-primary">
              {t('setting.mcp-market')}
            </span>
          </div>
          <div className="w-40 max-w-4xl">
            <SearchInput
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </>
      )}

      {/* Category toggle row */}
      <div className="flex w-full py-2">
        <ToggleGroup
          type="single"
          value={categoryId ? String(categoryId) : 'all'}
          onValueChange={(val) =>
            setCategoryId(!val || val === 'all' ? undefined : Number(val))
          }
          className="flex flex-wrap"
        >
          <ToggleGroupItem value="all">{t('setting.all')}</ToggleGroupItem>
          {mcpCategory.map((cat) => (
            <ToggleGroupItem key={cat.id} value={String(cat.id)}>
              {cat.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* list */}
      <MCPEnvDialog
        showEnvConfig={showEnvConfig}
        onClose={onClose}
        onConnect={onConnect}
        activeMcp={activeMcp}
      ></MCPEnvDialog>
      <div className="flex w-full flex-col gap-4 pt-4">
        {isLoading && items.length === 0 && (
          <div className="py-8 text-center text-text-muted">
            {t('setting.loading')}
          </div>
        )}
        {error && (
          <div className="py-8 text-center text-text-error">{error}</div>
        )}
        {!isLoading && !error && items.length === 0 && (
          <div className="py-8 text-center text-text-muted">
            {t('setting.no-mcp-services')}
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center rounded-2xl bg-surface-secondary p-4"
          >
            {/* Left: Icon */}
            <div className="mr-4 flex items-center">
              {(() => {
                const catName = item.category?.name;
                const normalizedName = catName?.toLowerCase() || '';
                const iconKey = normalizedName
                  ? categoryIconMap[normalizedName]
                  : undefined;
                const iconUrl = iconKey ? svgIcons[iconKey] : undefined;
                return iconUrl ? (
                  <img src={iconUrl} alt={catName} className="h-11 w-9" />
                ) : (
                  <Store className="h-11 w-9 text-icon-primary" />
                );
              })()}
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <div className="flex w-full items-center gap-xs pb-1">
                <div className="flex flex-1 items-center gap-xs">
                  <span className="truncate text-base font-bold leading-9 text-text-primary">
                    {item.name}
                  </span>
                  <TooltipSimple content={item.description}>
                    <CircleAlert className="h-4 w-4 text-icon-secondary" />
                  </TooltipSimple>
                </div>
                <Button
                  variant={
                    !installedIds.includes(item.id) ? 'primary' : 'secondary'
                  }
                  size="sm"
                  onClick={() =>
                    installedIds.includes(item.id)
                      ? handleDelete(item)
                      : checkEnv(item.id)
                  }
                >
                  {installedIds.includes(item.id)
                    ? t('setting.uninstall')
                    : installing[item.id]
                      ? t('setting.installing')
                      : installed[item.id]
                        ? t('setting.uninstall')
                        : t('setting.install')}
                </Button>
              </div>
              {item.home_page &&
                item.home_page.startsWith('https://github.com/') && (
                  <div className="flex items-center">
                    <img
                      src={githubIcon}
                      alt="github"
                      style={{
                        width: 14.7,
                        height: 14.7,
                        marginRight: 4,
                        display: 'inline-block',
                        verticalAlign: 'middle',
                      }}
                    />
                    <span className="items-center justify-center self-stretch text-xs font-medium leading-3">
                      {(() => {
                        const parts = item.home_page.split('/');
                        return parts.length > 4 ? parts[4] : item.home_page;
                      })()}
                    </span>
                  </div>
                )}
              <div className="mt-1 whitespace-pre-line break-words text-sm text-text-muted">
                {item.description}
              </div>
            </div>
          </div>
        ))}
        <div ref={loader} />
        {isLoading && items.length > 0 && (
          <div className="py-4 text-center text-text-muted">
            {t('setting.loading-more')}
          </div>
        )}
        {!hasMore && items.length > 0 && (
          <div className="py-4 text-center text-text-muted">
            {t('setting.no-more-mcp-servers')}
          </div>
        )}
      </div>
    </div>
  );
}
