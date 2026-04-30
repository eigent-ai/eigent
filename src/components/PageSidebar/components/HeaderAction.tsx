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
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { motion } from 'framer-motion';
import { PenLine, ScrollText } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { PROJECT_SIDEBAR_FOLD_SPRING } from '../constants';
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

/** Project sidebar: Instructions accordion (NavTab-aligned). */
export function HeaderAction() {
  const { t } = useTranslation();
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const requestWorkspaceChatFocus = usePageTabStore(
    (s) => s.requestWorkspaceChatFocus
  );
  const projectSidebarFolded = usePageTabStore((s) => s.projectSidebarFolded);
  const setProjectSidebarFolded = usePageTabStore(
    (s) => s.setProjectSidebarFolded
  );
  const openInstructionsAfterExpandRef = useRef(false);
  const [memoryOn, setMemoryOn] = useState(readMemoryInitial);
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

  const handleImportWorkforceTemplate = useCallback(() => {
    setActiveWorkspaceTab('workforce');
  }, [setActiveWorkspaceTab]);

  const handleEditInstructions = useCallback(() => {
    requestWorkspaceChatFocus();
  }, [requestWorkspaceChatFocus]);

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
                  className="h-4 w-4 text-ds-icon-neutral-muted-default shrink-0"
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
              <div className="-mr-1 gap-3 pl-7 flex flex-col">
                <div className="min-w-0 gap-2 rounded-lg hover:bg-ds-bg-neutral-subtle-default hover:ring-ds-bg-neutral-subtle-default hover:ring-offset-ds-bg-neutral-subtle-default flex items-center justify-between hover:ring-2 hover:ring-offset-2">
                  <span className="min-w-0 text-body-sm font-medium text-ds-text-neutral-muted-default flex-1">
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
                <div className="min-w-0 gap-2 rounded-lg hover:bg-ds-bg-neutral-subtle-default hover:ring-ds-bg-neutral-subtle-default hover:ring-offset-ds-bg-neutral-subtle-default flex items-center justify-between hover:ring-2 hover:ring-offset-2">
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
                <div className="min-w-0 gap-2 rounded-lg hover:bg-ds-bg-neutral-subtle-default hover:ring-ds-bg-neutral-subtle-default hover:ring-offset-ds-bg-neutral-subtle-default flex items-center justify-between hover:ring-2 hover:ring-offset-2">
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
  );
}
