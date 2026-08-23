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

import SearchInput from '@/components/Dashboard/SearchInput';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  SettingsHeaderActions,
  useSettingsHeader,
} from '../SettingsHeaderContext';
import SettingsSection from '../SettingsSection';
import SettingsSectionLoading from '../SettingsSectionLoading';
import SettingsSectionPage from '../SettingsSectionPage';
import SkillDeleteDialog from './components/SkillDeleteDialog';
import SkillListItem from './components/SkillListItem';
import SkillUploadDialog from './components/SkillUploadDialog';

export default function Skills() {
  const { t } = useTranslation();
  const { setHeaderOverride } = useSettingsHeader();
  const shouldReduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const { skills, syncFromDisk } = useSkillsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [hasCompletedInitialSync, setHasCompletedInitialSync] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [skillDialogMode, setSkillDialogMode] = useState<'upload' | 'create'>(
    'upload'
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [skillToDelete, setSkillToDelete] = useState<Skill | null>(null);
  const [activeSkillTab, setActiveSkillTab] = useState('your-skills');
  const activeSkillTitle =
    activeSkillTab === 'example-skills'
      ? t('agents.example-skills')
      : t('agents.your-skills');
  useEffect(() => {
    setHeaderOverride({ title: activeSkillTitle, hideTitle: true });
    return () => setHeaderOverride(null);
  }, [activeSkillTitle, setHeaderOverride]);

  // On first mount, sync skills from local SKILL.md files
  useEffect(() => {
    let isActive = true;

    // No-op on web; in Electron this will scan ~/.eigent/skills
    void syncFromDisk().finally(() => {
      if (isActive) {
        setHasCompletedInitialSync(true);
      }
    });

    return () => {
      isActive = false;
    };
  }, [syncFromDisk]);

  useEffect(() => {
    const action = searchParams.get('skillAction');
    if (action !== 'create' && action !== 'upload') return;
    setSkillDialogMode(action);
    setUploadDialogOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('skillAction');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const yourSkills = useMemo(() => {
    return skills
      .filter((skill) => !skill.isExample)
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          skill.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [skills, searchQuery]);

  const exampleSkills = useMemo(() => {
    return skills
      .filter((skill) => skill.isExample)
      .filter(
        (skill) =>
          skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          skill.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
  }, [skills, searchQuery]);

  const handleDeleteClick = (skill: Skill) => {
    setSkillToDelete(skill);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    setDeleteDialogOpen(false);
    setSkillToDelete(null);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setSkillToDelete(null);
  };

  const renderYourSkills = (animateChanges: boolean) => {
    if (!animateChanges) {
      return yourSkills.length === 0 ? (
        <SkillListItem
          variant="placeholder"
          message={
            searchQuery
              ? t('agents.no-skills-found')
              : t('agents.no-your-skills')
          }
          addButtonText={
            !searchQuery ? t('agents.add-your-first-skill') : undefined
          }
          onAddClick={
            !searchQuery
              ? () => {
                  setSkillDialogMode('upload');
                  setUploadDialogOpen(true);
                }
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {yourSkills.map((skill) => (
            <SkillListItem
              key={skill.id}
              skill={skill}
              onDelete={() => handleDeleteClick(skill)}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <AnimatePresence mode="popLayout" initial={false}>
          {yourSkills.length === 0 ? (
            <motion.div
              key="your-skills-placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.16,
                ease: [0.23, 1, 0.32, 1],
              }}
            >
              <SkillListItem
                variant="placeholder"
                message={t('agents.no-your-skills')}
                addButtonText={t('agents.add-your-first-skill')}
                onAddClick={() => {
                  setSkillDialogMode('upload');
                  setUploadDialogOpen(true);
                }}
              />
            </motion.div>
          ) : (
            yourSkills.map((skill) => (
              <motion.div
                key={skill.id}
                initial={{
                  opacity: 0,
                  transform: shouldReduceMotion
                    ? 'translateY(0px)'
                    : 'translateY(8px)',
                }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{
                  opacity: 0,
                  transform: shouldReduceMotion
                    ? 'translateY(0px)'
                    : 'translateY(-4px)',
                  transition: {
                    duration: 0.16,
                    ease: [0.23, 1, 0.32, 1],
                  },
                }}
                transition={{
                  duration: shouldReduceMotion ? 0.16 : 0.2,
                  ease: [0.23, 1, 0.32, 1],
                }}
              >
                <SkillListItem
                  skill={skill}
                  onDelete={() => handleDeleteClick(skill)}
                />
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <SettingsSectionPage>
      <SettingsHeaderActions>
        <Tabs value={activeSkillTab} onValueChange={setActiveSkillTab}>
          <TabsList appearance="default">
            <TabsTrigger value="your-skills">
              <span className="text-ds-text-base font-semibold text-ds-ink-default-default">
                {t('agents.your-skills')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="example-skills">
              <span className="text-ds-text-base font-semibold text-ds-ink-default-default">
                {t('agents.example-skills')}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-56 max-w-full">
            <SearchInput
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('agents.search-skills')}
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSkillDialogMode('upload');
              setUploadDialogOpen(true);
            }}
          >
            <Plus className="size-ds-icon-md" />
            {t('agents.add-skill')}
          </Button>
        </div>
      </SettingsHeaderActions>
      <SettingsSection titleVariant="hidden">
        {!hasCompletedInitialSync && skills.length === 0 ? (
          <SettingsSectionLoading
            label={t('setting.loading', {
              defaultValue: 'Loading skills',
            })}
            rows={3}
            className="py-0"
          />
        ) : activeSkillTab === 'your-skills' ? (
          renderYourSkills(hasCompletedInitialSync && searchQuery.length === 0)
        ) : exampleSkills.length === 0 ? (
          <SkillListItem
            variant="placeholder"
            message={
              searchQuery
                ? t('agents.no-skills-found')
                : t('agents.no-example-skills')
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {exampleSkills.map((skill) => (
              <SkillListItem
                key={skill.id}
                skill={skill}
                onDelete={undefined}
              />
            ))}
          </div>
        )}
      </SettingsSection>
      {/* Upload Dialog */}
      <SkillUploadDialog
        open={uploadDialogOpen}
        mode={skillDialogMode}
        onClose={() => setUploadDialogOpen(false)}
      />

      {/* Delete Dialog */}
      <SkillDeleteDialog
        open={deleteDialogOpen}
        skill={skillToDelete}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </SettingsSectionPage>
  );
}
