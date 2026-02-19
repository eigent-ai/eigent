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

import SearchInput from '@/components/SearchInput';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SkillDeleteDialog from './components/SkillDeleteDialog';
import SkillListItem from './components/SkillListItem';
import SkillUploadDialog from './components/SkillUploadDialog';

export default function Skills() {
  const { t } = useTranslation();
  const { skills, syncFromDisk } = useSkillsStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [skillToDelete, setSkillToDelete] = useState<Skill | null>(null);

  // On first mount, sync skills from local SKILL.md files
  useEffect(() => {
    // No-op on web; in Electron this will scan ~/.eigent/skills
    syncFromDisk();
  }, [syncFromDisk]);

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

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      {/* Header Section */}
      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('agents.skills')}
        </div>
      </div>

      {/* Content Section */}
      <div className="mb-12 flex flex-col gap-6">
        <div className="flex w-full flex-col items-center justify-between gap-4 rounded-2xl bg-surface-secondary px-6 py-4">
          <Tabs defaultValue="your-skills" className="w-full">
            <div className="sticky top-[84px] z-10 flex w-full items-center justify-between gap-4 border-x-0 border-b-[0.5px] border-t-0 border-solid border-border-secondary bg-surface-secondary">
              <TabsList
                variant="outline"
                className="h-auto flex-1 justify-start border-0 bg-transparent"
              >
                <TabsTrigger
                  value="your-skills"
                  className="data-[state=active]:bg-transparent"
                >
                  {t('agents.your-skills')}
                </TabsTrigger>
                {/* TODO: Add example skills back in */}
                {/* <TabsTrigger
                  value="example-skills"
                  className="data-[state=active]:bg-transparent"
                >
                  {t('agents.example-skills')}
                </TabsTrigger> */}
              </TabsList>
              <div className="flex items-center gap-2">
                <SearchInput
                  variant="icon"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('agents.search-skills')}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setUploadDialogOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  {t('agents.add-skill')}
                </Button>
              </div>
            </div>
            <TabsContent value="your-skills" className="mt-4">
              {yourSkills.length === 0 ? (
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
                    !searchQuery ? () => setUploadDialogOpen(true) : undefined
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
              )}
            </TabsContent>
            <TabsContent value="example-skills" className="mt-4">
              {exampleSkills.length === 0 ? (
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
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Upload Dialog */}
      <SkillUploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
      />

      {/* Delete Dialog */}
      <SkillDeleteDialog
        open={deleteDialogOpen}
        skill={skillToDelete}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}
