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

import folderIcon from '@/assets/Folder.svg';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { TooltipSimple } from '@/components/ui/tooltip';
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
import { PROJECT_SIDEBAR_FOLD_SPRING } from './constants';
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
  'data-[state=open]:bg-surface-tertiary'
);

const accordionTriggerClass = cn(
  workspaceTabButtonClass(false),
  'hover:no-underline',
  'py-0 min-h-8',
  '[&>svg:last-child]:text-icon-secondary [&>svg:last-child]:shrink-0'
);

const coworkRowClass = cn(
  'no-drag h-8 min-h-8 w-full min-w-0 shrink-0 rounded-xl',
  'flex items-center',
  'outline-none overflow-hidden'
);

/** Project sidebar top: Cowork row + Instructions accordion (NavTab-aligned). */
export function HeaderAction() {
  const { t } = useTranslation();
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
    const ipc = window.ipcRenderer;
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
  }, []);

  const handleStartDownload = useCallback(() => {
    void window.ipcRenderer?.invoke('start-download');
  }, []);

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
    <div className="min-w-0 flex items-stretch">
      <div className="no-drag min-w-0 w-full overflow-hidden">
        <div className="gap-2 flex w-full flex-col">
          <div className={coworkRowClass}>
            <div className="h-8 flex shrink-0 items-center justify-center">
              <TooltipSimple
                content={foldTooltip}
                enabled
                side="right"
                align="center"
              >
                <button
                  type="button"
                  className={cn(
                    'no-drag h-8 px-3 rounded-lg text-icon-primary flex shrink-0 items-center justify-center',
                    'hover:bg-surface-secondary/80 focus-visible:ring-border-secondary focus-visible:ring-2 focus-visible:outline-none'
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
                'min-w-0 text-body-sm font-bold gap-2 flex flex-1 items-center overflow-hidden text-left'
              )}
              initial={false}
              animate={{
                opacity: projectSidebarFolded ? 0 : 1,
                maxWidth: projectSidebarFolded ? 0 : 1600,
              }}
              transition={PROJECT_SIDEBAR_FOLD_SPRING}
              aria-hidden={projectSidebarFolded}
            >
              <img
                src={folderIcon}
                alt=""
                className="h-6 w-6 mt-1 -ml-0.5 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{coworkLabel}</span>
            </motion.span>
            <motion.div
              className="mr-3 min-h-8 min-w-0 flex shrink-0 items-center justify-end overflow-hidden"
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
                    'min-w-0 flex flex-1 items-center overflow-hidden',
                    projectSidebarFolded ? 'gap-0' : 'gap-3'
                  )}
                >
                  <ScrollText
                    className="h-4 w-4 text-icon-primary shrink-0"
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
                <div className="gap-3 pl-7 -mr-1 flex flex-col">
                  <div className="gap-2 min-w-0 hover:bg-surface-primary rounded-lg hover:ring-surface-primary hover:ring-offset-surface-primary flex items-center justify-between hover:ring-2 hover:ring-offset-2">
                    <span className="min-w-0 text-text-label text-body-sm font-medium flex-1">
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
                  <div className="gap-2 min-w-0 hover:bg-surface-primary rounded-lg hover:ring-surface-primary hover:ring-offset-surface-primary flex items-center justify-between hover:ring-2 hover:ring-offset-2">
                    <span className="min-w-0 text-text-label text-body-sm font-medium">
                      {memoryLabel}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="no-drag shrink-0"
                      onClick={() => setMemoryOn((v) => !v)}
                      aria-pressed={memoryOn}
                      aria-label={`${memoryLabel}: ${memoryOn ? memoryOnLabel : memoryOffLabel}`}
                    >
                      {memoryOn ? memoryOnLabel : memoryOffLabel}
                    </Button>
                  </div>
                  <div className="gap-2 min-w-0 hover:bg-surface-primary rounded-lg hover:ring-surface-primary hover:ring-offset-surface-primary flex items-center justify-between hover:ring-2 hover:ring-offset-2">
                    <span className="min-w-0 text-text-label text-body-sm font-medium">
                      {workforceSettingLabel}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
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
