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

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { motion } from 'framer-motion';
import { PanelLeft, PanelLeftClose, PenLine, ScrollText } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  PROJECT_SIDEBAR_FOLD_SPRING,
  SIDEBAR_TOOLTIP_CONTENT_CLASS,
} from './constants';
import { WORKSPACE_TAB_LABEL_CLASS, workspaceTabButtonClass } from './NavTab';

const MEMORY_STORAGE_KEY = 'eigent-sidebar-instructions-memory-on';
const INSTRUCTIONS_ACCORDION_STORAGE_KEY =
  'eigent-sidebar-instructions-accordion-open';

function readMemoryInitial(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem(MEMORY_STORAGE_KEY);
  if (v === null) return true;
  return v === 'true';
}

function readInstructionsAccordionPreference(): string | undefined {
  if (typeof window === 'undefined') return 'instructions';
  const v = window.localStorage.getItem(INSTRUCTIONS_ACCORDION_STORAGE_KEY);
  if (v === null) return 'instructions';
  return v === 'true' ? 'instructions' : undefined;
}

const accordionItemClass = cn(
  'border-none rounded-xl transition-colors',
  'data-[state=open]:bg-ds-bg-neutral-subtle-default'
);

const accordionTriggerClass = cn(
  workspaceTabButtonClass(false),
  'hover:no-underline',
  'hover:bg-ds-bg-neutral-subtle-default',
  'py-0 min-h-8',
  '[&>svg:last-child]:text-ds-icon-neutral-muted-default [&>svg:last-child]:shrink-0'
);

const coworkRowClass = cn(
  'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-xl',
  'flex items-center',
  'outline-none overflow-hidden'
);

/** Project sidebar top: Cowork row + Instructions accordion (NavTab-aligned). */
export function HeaderAction() {
  const { t } = useTranslation();
  const host = useHost();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const toggleProjectSidebarFolded = usePageTabStore(
    (s) => s.toggleProjectSidebarFolded
  );
  const setProjectSidebarFolded = usePageTabStore(
    (s) => s.setProjectSidebarFolded
  );
  const openInstructionsAfterExpandRef = useRef(false);
  const [memoryOn, setMemoryOn] = useState(readMemoryInitial);
  const [packageUpdateAvailable, setPackageUpdateAvailable] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState<string | undefined>(
    readInstructionsAccordionPreference
  );
  const ipcRenderer = host?.ipcRenderer;

  useLayoutEffect(() => {
    if (projectSidebarFolded) {
      setInstructionsOpen(undefined);
    } else if (openInstructionsAfterExpandRef.current) {
      openInstructionsAfterExpandRef.current = false;
      setInstructionsOpen('instructions');
    } else {
      setInstructionsOpen(readInstructionsAccordionPreference());
    }
  }, [projectSidebarFolded]);

  useEffect(() => {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, String(memoryOn));
  }, [memoryOn]);

  useEffect(() => {
    if (projectSidebarFolded) return;
    window.localStorage.setItem(
      INSTRUCTIONS_ACCORDION_STORAGE_KEY,
      instructionsOpen === 'instructions' ? 'true' : 'false'
    );
  }, [instructionsOpen, projectSidebarFolded]);

  useEffect(() => {
    const ipc = ipcRenderer;
    if (!ipc) return;

    const onUpdateCanAvailable = (
      _event: Electron.IpcRendererEvent,
      info: VersionInfo
    ) => {
      setPackageUpdateAvailable(Boolean(info.update));
    };

    const onUpdateDownloaded = () => {
      setPackageUpdateAvailable(false);
    };

    ipc.on('update-can-available', onUpdateCanAvailable);
    ipc.on('update-downloaded', onUpdateDownloaded);
    void ipc.invoke('check-update');

    return () => {
      ipc.off('update-can-available', onUpdateCanAvailable);
      ipc.off('update-downloaded', onUpdateDownloaded);
    };
  }, [ipcRenderer]);

  const handleStartDownload = useCallback(() => {
    void ipcRenderer?.invoke('start-download');
  }, [ipcRenderer]);

  const handleImportWorkforceTemplate = useCallback(() => {
    setActiveWorkspaceTab('workforce');
  }, [setActiveWorkspaceTab]);

  const handleEditInstructions = useCallback(() => {
    requestWorkspaceChatFocus();
  }, [requestWorkspaceChatFocus]);

  const foldTooltip = projectSidebarFolded
    ? t('layout.expand-project-sidebar', { defaultValue: 'Expand sidebar' })
    : t('layout.fold-project-sidebar', { defaultValue: 'Fold sidebar' });
  const updateLabel = t('layout.update', { defaultValue: 'Update' });
  const coworkLabel = t('layout.cowork', { defaultValue: 'Eigent' });
  const instructionsLabel = t('layout.instructions', {
    defaultValue: 'Instructions',
  });
  const instructionsHint = t('layout.instructions-rules-tone', {
    defaultValue: 'Rules & Tone',
  });
  const memoryLabel = t('layout.memory', { defaultValue: 'Memory' });
  const memoryOnLabel = t('layout.memory-on', { defaultValue: 'On' });
  const memoryOffLabel = t('layout.memory-off', { defaultValue: 'Off' });
  const workforceSettingLabel = t('layout.workforce-setting', {
    defaultValue: 'Workforce Setting',
  });
  const selectLabel = t('layout.select', { defaultValue: 'Select' });
  const editInstructionsLabel = t('layout.edit-instructions', {
    defaultValue: 'Edit instructions',
  });

  return (
    <div className="flex min-w-0 items-stretch">
      <div className="no-drag w-full min-w-0 overflow-hidden">
        <div className="flex w-full flex-col gap-2">
          <div className={coworkRowClass}>
            <div className="flex h-8 shrink-0 items-center justify-center">
              <TooltipSimple
                content={foldTooltip}
                enabled
                side="right"
                align="center"
                className={SIDEBAR_TOOLTIP_CONTENT_CLASS}
              >
                <button
                  type="button"
                  className={cn(
                    'no-drag flex h-8 shrink-0 items-center justify-center rounded-lg px-3 text-ds-icon-neutral-muted-default transition-colors duration-200 ease-in-out',
                    'hover:bg-ds-bg-neutral-subtle-hover hover:text-ds-icon-neutral-muted-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-neutral-subtle-default'
                  )}
                  aria-label={foldTooltip}
                  onClick={() => toggleProjectSidebarFolded()}
                >
                  {projectSidebarFolded ? (
                    <PanelLeft className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                </button>
              </TooltipSimple>
            </div>
            <motion.span
              className={cn(
                WORKSPACE_TAB_LABEL_CLASS,
                'flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-left text-body-sm font-bold'
              )}
              initial={false}
              animate={{
                opacity: projectSidebarFolded ? 0 : 1,
                maxWidth: projectSidebarFolded ? 0 : 1600,
              }}
              transition={PROJECT_SIDEBAR_FOLD_SPRING}
              aria-hidden={projectSidebarFolded}
            >
              <span className="min-w-0 flex-1 truncate">{coworkLabel}</span>
            </motion.span>
            <motion.div
              className="mr-3 flex min-h-8 min-w-0 shrink-0 items-center justify-end overflow-hidden"
              initial={false}
              animate={{
                opacity: projectSidebarFolded ? 0 : 1,
                maxWidth: projectSidebarFolded ? 0 : 200,
              }}
              transition={PROJECT_SIDEBAR_FOLD_SPRING}
              aria-hidden={projectSidebarFolded}
              style={{
                pointerEvents: projectSidebarFolded ? 'none' : undefined,
              }}
            >
              {packageUpdateAvailable ? (
                <Button
                  type="button"
                  variant="primary"
                  size="xs"
                  className="no-drag shrink-0"
                  onClick={handleStartDownload}
                >
                  {updateLabel}
                </Button>
              ) : null}
            </motion.div>
          </div>

          <Accordion
            type="single"
            collapsible
            value={instructionsOpen ?? ''}
            onValueChange={(v) => {
              if (projectSidebarFolded) return;
              const next = v || undefined;
              setInstructionsOpen(next);
            }}
            className="w-full"
          >
            <AccordionItem value="instructions" className={accordionItemClass}>
              <AccordionTrigger
                className={cn(
                  accordionTriggerClass,
                  projectSidebarFolded && '[&>svg:last-child]:hidden'
                )}
                title={
                  projectSidebarFolded ? String(instructionsLabel) : undefined
                }
                onClick={(e) => {
                  if (!projectSidebarFolded) return;
                  openInstructionsAfterExpandRef.current = true;
                  setProjectSidebarFolded(false);
                  e.preventDefault();
                }}
              >
                <span
                  className={cn(
                    'flex min-w-0 flex-1 items-center overflow-hidden',
                    projectSidebarFolded ? 'gap-0' : 'gap-3'
                  )}
                >
                  <ScrollText
                    className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default"
                    aria-hidden
                  />
                  <motion.span
                    className={cn(WORKSPACE_TAB_LABEL_CLASS, 'min-w-0 flex-1')}
                    initial={false}
                    animate={{
                      opacity: projectSidebarFolded ? 0 : 1,
                      maxWidth: projectSidebarFolded ? 0 : 1600,
                    }}
                    transition={PROJECT_SIDEBAR_FOLD_SPRING}
                    aria-hidden={projectSidebarFolded}
                  >
                    {instructionsLabel}
                  </motion.span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="px-3 py-3">
                <div className="-mr-1 flex flex-col gap-3 pl-7">
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg hover:bg-ds-bg-neutral-subtle-default hover:ring-2 hover:ring-ds-bg-neutral-subtle-default hover:ring-offset-2 hover:ring-offset-ds-bg-neutral-subtle-default">
                    <span className="min-w-0 flex-1 text-body-sm font-medium text-ds-text-neutral-muted-default">
                      {instructionsHint}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      buttonContent="icon-only"
                      className="no-drag shrink-0"
                      aria-label={editInstructionsLabel}
                      onClick={handleEditInstructions}
                    >
                      <PenLine className="h-4 w-4 shrink-0" aria-hidden />
                    </Button>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg hover:bg-ds-bg-neutral-subtle-default hover:ring-2 hover:ring-ds-bg-neutral-subtle-default hover:ring-offset-2 hover:ring-offset-ds-bg-neutral-subtle-default">
                    <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default">
                      {memoryLabel}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="no-drag shrink-0"
                      onClick={() => setMemoryOn((v) => !v)}
                      aria-pressed={memoryOn}
                      aria-label={`${memoryLabel}: ${memoryOn ? memoryOnLabel : memoryOffLabel}`}
                    >
                      {memoryOn ? memoryOnLabel : memoryOffLabel}
                    </Button>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg hover:bg-ds-bg-neutral-subtle-default hover:ring-2 hover:ring-ds-bg-neutral-subtle-default hover:ring-offset-2 hover:ring-offset-ds-bg-neutral-subtle-default">
                    <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default">
                      {workforceSettingLabel}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="xs"
                      className="no-drag shrink-0"
                      onClick={handleImportWorkforceTemplate}
                      aria-label={`${workforceSettingLabel}: ${selectLabel}`}
                    >
                      {selectLabel}
                    </Button>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
    </div>
  );
}
