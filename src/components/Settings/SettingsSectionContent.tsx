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

import type { SettingsSectionId } from '@/store/settingsStore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LoaderCircle } from 'lucide-react';
import { lazy, type RefObject, Suspense, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import SettingsContentShell from './SettingsContentShell';

const sectionLoaders = {
  models: () => import('./Models'),
  skills: () => import('./Skills'),
  'sub-agents': () => import('./SubAgents'),
  memory: () => import('./Memory'),
  connectors: () => import('./Connectors'),
  channels: () => import('./Channels'),
  'browser-connections': () => import('./Browser'),
  'browser-plugins': () => import('./Extension'),
  cookies: () => import('./Cookies'),
  settings: () => import('./SettingsOverview'),
} satisfies Partial<
  Record<SettingsSectionId, () => Promise<{ default: React.ComponentType }>>
>;

const Models = lazy(sectionLoaders.models);
const Skills = lazy(sectionLoaders.skills);
const SubAgents = lazy(sectionLoaders['sub-agents']);
const Memory = lazy(sectionLoaders.memory);
const Connectors = lazy(sectionLoaders.connectors);
const Channels = lazy(sectionLoaders.channels);
const BrowserConnections = lazy(sectionLoaders['browser-connections']);
const BrowserPlugins = lazy(sectionLoaders['browser-plugins']);
const Cookies = lazy(sectionLoaders.cookies);
const SettingsOverview = lazy(sectionLoaders.settings);

export function preloadSettingsSection(section: SettingsSectionId) {
  void sectionLoaders[section as keyof typeof sectionLoaders]?.().catch(
    () => undefined
  );
}

interface SettingsSectionContentProps {
  activeSection: SettingsSectionId;
}

function SectionFallback() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[320px] w-full items-center justify-center text-ds-ink-muted-default"
    >
      <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      <span className="sr-only">
        {t('setting.loading', { defaultValue: 'Loading settings' })}
      </span>
    </div>
  );
}

function SettingsSection({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case 'models':
      return <Models />;
    case 'sub-agents':
      return <SubAgents />;
    case 'connectors':
      return <Connectors />;
    case 'skills':
      return <Skills />;
    case 'channels':
      return <Channels />;
    case 'memory':
      return <Memory homeOverview />;
    case 'browser-connections':
      return <BrowserConnections />;
    case 'browser-plugins':
      return <BrowserPlugins />;
    case 'cookies':
      return <Cookies />;
    case 'settings':
      return <SettingsOverview />;
  }
}

interface AnimatedSettingsSectionProps {
  section: SettingsSectionId;
  scrollRef: RefObject<HTMLDivElement>;
  shouldReduceMotion: boolean | null;
}

function AnimatedSettingsSection({
  section,
  scrollRef,
  shouldReduceMotion,
}: AnimatedSettingsSectionProps) {
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [scrollRef]);

  return (
    <motion.div
      data-settings-section={section}
      className="min-h-full"
      initial={
        shouldReduceMotion
          ? { opacity: 1 }
          : { opacity: 0, transform: 'translateY(6px)' }
      }
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={
        shouldReduceMotion
          ? { opacity: 1 }
          : { opacity: 0, transform: 'translateY(-3px)' }
      }
      transition={{
        duration: shouldReduceMotion ? 0 : 0.14,
        ease: [0.23, 1, 0.32, 1],
      }}
    >
      <Suspense fallback={<SectionFallback />}>
        <SettingsSection section={section} />
      </Suspense>
    </motion.div>
  );
}

export default function SettingsSectionContent({
  activeSection,
}: SettingsSectionContentProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  return (
    <SettingsContentShell scrollRef={scrollRef}>
      <AnimatePresence mode="wait" initial={false}>
        <AnimatedSettingsSection
          key={activeSection}
          section={activeSection}
          scrollRef={scrollRef}
          shouldReduceMotion={shouldReduceMotion}
        />
      </AnimatePresence>
    </SettingsContentShell>
  );
}
