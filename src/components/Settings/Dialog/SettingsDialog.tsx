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

import { useSettingsDialogStore } from '@/store/settingsDialogStore';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { SettingsHeaderProvider } from '../SettingsHeaderContext';
import SettingsDialogContent from './SettingsDialogContent';
import SettingsDialogHeader from './SettingsDialogHeader';
import SettingsDialogOverlay from './SettingsDialogOverlay';
import SettingsDialogSidebar from './SettingsDialogSidebar';

export default function SettingsDialog() {
  const { t } = useTranslation();
  const shouldReduceMotion = useReducedMotion();
  const isOpen = useSettingsDialogStore((state) => state.isOpen);
  const activeSection = useSettingsDialogStore((state) => state.activeSection);
  const closeSettings = useSettingsDialogStore((state) => state.closeSettings);
  const setActiveSection = useSettingsDialogStore(
    (state) => state.setActiveSection
  );

  return (
    <DialogPrimitive.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) closeSettings();
      }}
    >
      <DialogPrimitive.Portal forceMount>
        <div className="contents">
          <AnimatePresence initial={false}>
            {isOpen ? (
              <>
                <SettingsDialogOverlay forceMount asChild>
                  <motion.div
                    key="settings-dialog-overlay"
                    initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                    animate={{ opacity: 1, backdropFilter: 'blur(4px)' }}
                    exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                    transition={{
                      duration: shouldReduceMotion ? 0.12 : 0.2,
                      ease: [0.2, 0, 0, 1],
                    }}
                  />
                </SettingsDialogOverlay>
                <DialogPrimitive.Content forceMount asChild>
                  <motion.div
                    key="settings-dialog-content"
                    data-testid="settings-dialog-content"
                    className="max-md:h-screen max-md:w-screen max-md:rounded-none fixed inset-0 z-50 m-auto flex h-[min(820px,calc(100vh-32px))] w-[min(1180px,calc(100vw-32px))] origin-center overflow-hidden rounded-2xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default shadow-perfect outline-none"
                    initial={
                      shouldReduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, scale: 0.94, filter: 'blur(12px)' }
                    }
                    animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                    exit={
                      shouldReduceMotion
                        ? { opacity: 0 }
                        : { opacity: 0, scale: 0.96, filter: 'blur(10px)' }
                    }
                    transition={{
                      duration: shouldReduceMotion ? 0.12 : 0.24,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  >
                    <DialogPrimitive.Title asChild>
                      <span className="sr-only text-body-md font-bold">
                        {t('layout.settings', { defaultValue: 'Settings' })}
                      </span>
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description asChild>
                      <span className="sr-only text-body-sm">
                        {t('layout.settings-dialog-description', {
                          defaultValue:
                            'Configure Workspace, Device, and application settings.',
                        })}
                      </span>
                    </DialogPrimitive.Description>

                    <SettingsDialogSidebar
                      activeSection={activeSection}
                      onSectionChange={setActiveSection}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <SettingsHeaderProvider activeSection={activeSection}>
                        <SettingsDialogHeader activeSection={activeSection} />
                        <SettingsDialogContent activeSection={activeSection} />
                      </SettingsHeaderProvider>
                    </div>
                  </motion.div>
                </DialogPrimitive.Content>
              </>
            ) : null}
          </AnimatePresence>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
