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

import { fetchGet, fetchPost } from '@/api/http';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipSimple,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AnimatePresence, motion } from 'framer-motion';
import { Cable, CircleAlert, Settings2, X } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useIntegrationManagement,
  type IntegrationItem,
} from '@/hooks/useIntegrationManagement';
import { getProxyBaseURL } from '@/lib';
import { OAuth } from '@/lib/oauth';
import { cn } from '@/lib/utils';
import { MCPEnvDialog } from '@/pages/Connectors/components/MCPEnvDialog';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

type IntegrationListVariant = 'select' | 'manage';

interface IntegrationListProps {
  items: IntegrationItem[];
  variant?: IntegrationListVariant; // "select" for AddWorker, "manage" for Setting

  // Select mode props (AddWorker)
  addOption?: (mcp: any, isLocal: boolean) => void;
  onShowEnvConfig?: (mcp: any) => void;

  // Manage mode props (Setting)
  showSelect?: boolean;
  selectPlaceholder?: string;
  selectValue?: string;
  selectContent?: React.ReactNode;
  onSelectChange?: (value: string, item: IntegrationItem) => void;
  showConfigButton?: boolean;
  showInstallButton?: boolean;
  onConfigClick?: (item: IntegrationItem) => void;
  showStatusDot?: boolean;

  // Common props
  installedKeys?: string[];
  oauth?: OAuth | null;
  translationNamespace?: 'layout' | 'setting'; // For translation keys
}

export default function IntegrationList({
  items,
  variant = 'manage', // Default to manage mode for backward compatibility
  addOption,
  onShowEnvConfig,
  showSelect = false,
  selectPlaceholder = 'Select...',
  selectValue,
  selectContent,
  onSelectChange,
  showConfigButton = true,
  showInstallButton = true,
  onConfigClick,
  showStatusDot = true,
  installedKeys: _installedKeys = [],
  oauth: _oauth,
  translationNamespace = variant === 'select' ? 'layout' : 'setting',
}: IntegrationListProps) {
  const { t } = useTranslation();
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [activeMcp, setActiveMcp] = useState<any | null>(null);
  const isSelectMode = variant === 'select';

  // Per-item error state for status dot
  const [errorKeys, setErrorKeys] = useState<Record<string, boolean>>({});
  const errorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const markError = useCallback((key: string) => {
    setErrorKeys((prev) => ({ ...prev, [key]: true }));
    if (errorTimers.current[key]) clearTimeout(errorTimers.current[key]);
    errorTimers.current[key] = setTimeout(() => {
      setErrorKeys((prev) => ({ ...prev, [key]: false }));
      delete errorTimers.current[key];
    }, 4000);
  }, []);

  useEffect(() => {
    return () => {
      for (const id of Object.values(errorTimers.current)) {
        clearTimeout(id);
      }
      errorTimers.current = {};
    };
  }, []);

  // Use shared hook for integration management
  const {
    installed,
    configsHydrated: installStateReady,
    fetchInstalled,
    saveEnvAndConfig,
    handleUninstall,
    createMcpFromItem,
  } = useIntegrationManagement(items);

  // Install handler - different logic for select vs manage mode
  const handleInstall = useCallback(
    async (item: IntegrationItem) => {
      console.log(item);
      const searchKey = isSelectMode ? 'EXA Search' : 'Search';

      if (item.key === searchKey || item.key === 'Lark' || item.key === 'RAG') {
        const mcp = createMcpFromItem(
          item,
          item.key === 'Lark' ? 15 : item.key === 'RAG' ? 16 : 13
        );
        if (isSelectMode) {
          onShowEnvConfig?.(mcp);
        } else {
          setActiveMcp(mcp);
          setShowEnvConfig(true);
        }
        return;
      }

      if (item.key === 'Google Calendar') {
        const mcp = createMcpFromItem(item, 14);
        if (isSelectMode) {
          onShowEnvConfig?.(mcp);
        } else {
          setActiveMcp(mcp);
          setShowEnvConfig(true);
        }
        return;
      }

      // LinkedIn uses server-side OAuth flow
      if (item.key === 'LinkedIn') {
        // Open LinkedIn OAuth login via the remote server (same pattern as other OAuth providers)
        const baseUrl = getProxyBaseURL();
        const oauthUrl = `${baseUrl}/api/v1/oauth/linkedin/login`;
        window.open(oauthUrl, '_blank', 'width=600,height=700');
        return;
      }

      if (installed[item.key]) return;
      try {
        await item.onInstall();
      } catch {
        markError(item.key);
        return;
      }
      // Only refresh in select mode
      if (isSelectMode) {
        await fetchInstalled();
      }
    },
    [
      installed,
      createMcpFromItem,
      isSelectMode,
      onShowEnvConfig,
      fetchInstalled,
      markError,
    ]
  );

  // onConnect handler - different logic for select vs manage mode
  const onConnect = async (mcp: any) => {
    console.log('[IntegrationList onConnect] Starting for', mcp.key);

    // Refresh configs first to get latest state
    await fetchInstalled();

    // Save all environment variables
    await Promise.all(
      Object.keys(mcp.install_command.env).map(async (key) => {
        return saveEnvAndConfig(mcp.key, key, mcp.install_command.env[key]);
      })
    );

    // After saving env vars, handle Google Calendar authorization flow
    if (mcp.key === 'Google Calendar') {
      console.log(
        '[IntegrationList onConnect] Google Calendar detected, starting auth flow'
      );

      // Trigger install/authorization
      const calendarItem = items.find((item) => item.key === 'Google Calendar');
      try {
        if (calendarItem && calendarItem.onInstall) {
          await calendarItem.onInstall();
        } else {
          await fetchPost('/install/tool/google_calendar');
        }
      } catch (_) {}

      // Select mode: poll OAuth status
      if (isSelectMode) {
        console.log(
          '[IntegrationList onConnect] Starting OAuth status polling'
        );

        const start = Date.now();
        const timeoutMs = 5 * 60 * 1000; // 5 minutes
        while (Date.now() - start < timeoutMs) {
          try {
            const statusRes: any = await fetchGet(
              '/oauth/status/google_calendar'
            );
            console.log(
              '[IntegrationList onConnect] OAuth status:',
              statusRes?.status
            );

            if (statusRes?.status === 'success') {
              console.log(
                '[IntegrationList onConnect] Success! Closing dialog'
              );
              await fetchInstalled();
              onClose();
              return;
            }
            if (
              statusRes?.status === 'failed' ||
              statusRes?.status === 'cancelled'
            ) {
              console.log(
                '[IntegrationList onConnect] Failed/cancelled, keeping dialog open'
              );
              return;
            }
          } catch (err) {
            console.log('[IntegrationList onConnect] Polling error:', err);
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        console.log('[IntegrationList onConnect] Polling timeout');
        return;
      }
    }

    // Select mode: add to tools and close
    if (isSelectMode && addOption) {
      console.log(
        '[IntegrationList onConnect] Non-Google Calendar, closing immediately'
      );
      await fetchInstalled();
      addOption(mcp, true);
      onClose();
    } else {
      // Manage mode: just close
      await fetchInstalled();
      onClose();
    }
  };

  const onClose = () => {
    setShowEnvConfig(false);
    setActiveMcp(null);
  };

  const handleOpenConfig = useCallback(
    (item: IntegrationItem) => {
      // if external handler provided by parent, use it
      if (onConfigClick) {
        onConfigClick(item);
        return;
      }
      // default behavior: if item has env vars, open built-in MCP config dialog
      if (item?.env_vars && item.env_vars.length > 0) {
        const mcp = createMcpFromItem(item, -1);
        setActiveMcp(mcp);
        setShowEnvConfig(true);
      }
    },
    [onConfigClick, createMcpFromItem]
  );

  const COMING_SOON_ITEMS = useMemo(
    () => [
      'X(Twitter)',
      'WhatsApp',
      // "LinkedIn", // LinkedIn OAuth is now supported
      'Reddit',
      'Github',
    ],
    []
  );

  const sortedItems = useMemo(() => {
    const available = items.filter(
      (item) => !COMING_SOON_ITEMS.includes(item.name)
    );
    const comingSoon = items.filter((item) =>
      COMING_SOON_ITEMS.includes(item.name)
    );
    return [...available, ...comingSoon];
  }, [items, COMING_SOON_ITEMS]);

  // Determine container and item styles based on variant
  const containerClassName = isSelectMode
    ? 'space-y-3'
    : 'flex flex-col w-full items-start justify-start gap-4';

  const itemClassName = isSelectMode
    ? cn(
        'px-3 py-2 flex justify-between',
        installStateReady
          ? 'cursor-pointer hover:bg-surface-hover-subtle'
          : 'cursor-wait opacity-70'
      )
    : 'w-full px-6 py-4 bg-surface-tertiary rounded-2xl';

  const titleClassName = isSelectMode
    ? 'text-base leading-snug font-bold text-text-action'
    : 'text-label-lg font-bold text-text-heading';

  return (
    <div className={containerClassName}>
      <MCPEnvDialog
        showEnvConfig={showEnvConfig}
        onClose={onClose}
        onConnect={onConnect}
        activeMcp={activeMcp}
      ></MCPEnvDialog>
      {sortedItems.map((item) => {
        const isInstalled = !!installed[item.key];
        const isComingSoon = COMING_SOON_ITEMS.includes(item.name);
        const leadStatusDotClass = cn(
          'mr-2 h-3 w-3 shrink-0 rounded-full',
          !installStateReady
            ? 'bg-icon-secondary'
            : errorKeys[item.key]
              ? 'bg-icon-warning'
              : isInstalled
                ? 'bg-icon-success'
                : 'bg-icon-secondary'
        );

        return (
          <div key={item.key} className="w-full">
            <div
              className={itemClassName}
              onClick={
                isSelectMode
                  ? () => {
                      if (!installStateReady || isComingSoon) return;
                      if (item.env_vars.length === 0 || isInstalled) {
                        const normalizedToolkit =
                          item.name === 'Notion'
                            ? 'notion_mcp_toolkit'
                            : item.toolkit;
                        addOption?.(
                          { ...item, toolkit: normalizedToolkit },
                          true
                        );
                      } else {
                        handleInstall(item);
                      }
                    }
                  : undefined
              }
            >
              {isSelectMode ? (
                <div className="gap-xs flex items-center">
                  {(isSelectMode || showStatusDot) && (
                    <div className={leadStatusDotClass} aria-hidden />
                  )}
                  <div className={titleClassName}>{item.name}</div>
                  <div className="flex items-center">
                    <TooltipSimple content={item.desc}>
                      <CircleAlert className="h-4 w-4 text-icon-secondary" />
                    </TooltipSimple>
                  </div>
                </div>
              ) : (
                <div className="gap-xs flex w-full flex-row items-center justify-between">
                  <div className="gap-xs flex flex-row items-center">
                    {showStatusDot && (
                      <div className={leadStatusDotClass} aria-hidden />
                    )}
                    <div className={titleClassName}>{item.name}</div>
                    <div className="flex items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <CircleAlert className="h-4 w-4 text-icon-secondary" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <div>{item.desc}</div>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <div className="gap-md flex flex-row items-center">
                    {showConfigButton && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleOpenConfig(item);
                        }}
                      >
                        <Settings2 className="h-4 w-4" />
                        {t('setting.setting')}
                      </Button>
                    )}
                    {showInstallButton && (
                      <InstallButton
                        item={item}
                        isComingSoon={isComingSoon}
                        installStateReady={installStateReady}
                        isInstalled={isInstalled}
                        onInstall={handleInstall}
                        onUninstall={handleUninstall}
                        translationNamespace={translationNamespace}
                      />
                    )}
                  </div>
                </div>
              )}
              {isSelectMode && item.env_vars.length !== 0 && (
                <InstallButton
                  item={item}
                  isComingSoon={isComingSoon}
                  installStateReady={installStateReady}
                  isInstalled={isInstalled}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  translationNamespace={translationNamespace}
                />
              )}
            </div>

            {!isSelectMode && showSelect && (
              <div className="mt-6 gap-md border-border-secondary pt-6 flex w-full flex-row items-center border-x-0 border-b-0 border-solid">
                <div className="gap-md flex w-full flex-row items-center justify-between">
                  <div className="text-body-md text-text-body">
                    {' '}
                    Default {item.name}
                  </div>
                  <Select
                    {...(selectValue !== undefined && { value: selectValue })}
                    onValueChange={(v) => onSelectChange?.(v, item)}
                  >
                    <SelectTrigger size="default" className="w-[240px]">
                      <SelectValue placeholder={selectPlaceholder} />
                    </SelectTrigger>
                    <SelectContent className="z-100">
                      {selectContent ?? (
                        <>
                          <SelectItem value="more">
                            More integrations
                          </SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Connect / Disconnect button with hover X icon ──

function InstallButton({
  item,
  isComingSoon,
  installStateReady,
  isInstalled,
  onInstall,
  onUninstall,
  translationNamespace,
}: {
  item: IntegrationItem;
  isComingSoon: boolean;
  installStateReady: boolean;
  isInstalled: boolean;
  onInstall: (item: IntegrationItem) => void;
  onUninstall: (item: IntegrationItem) => void;
  translationNamespace: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);

  // Coming soon
  if (isComingSoon) {
    return (
      <Button type="button" disabled variant="ghost" size="sm" rounded="full">
        {t(`${translationNamespace}.coming-soon`)}
      </Button>
    );
  }

  if (!installStateReady) {
    return (
      <Button
        type="button"
        disabled
        variant="primary"
        size="sm"
        rounded="full"
        className="min-w-[5.5rem]"
      >
        {t('setting.loading')}
      </Button>
    );
  }

  // Connected → ghost "Disconnect" with leading X on hover
  if (isInstalled) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        rounded="full"
        className="transition-all duration-200"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onUninstall(item);
        }}
      >
        <AnimatePresence>
          {hovered && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="inline-flex overflow-hidden"
            >
              <X className="h-3.5 w-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
        {t(`${translationNamespace}.disconnect`)}
      </Button>
    );
  }

  // Not connected → "Connect" with leading Cable icon on hover
  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      rounded="full"
      className="transition-all duration-200"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onInstall(item);
      }}
    >
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="inline-flex overflow-hidden"
          >
            <Cable className="h-3.5 w-3.5" />
          </motion.span>
        )}
      </AnimatePresence>
      {t(`${translationNamespace}.connect`)}
    </Button>
  );
}
