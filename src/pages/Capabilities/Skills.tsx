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
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
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
  const [collapsedYourSkills, setCollapsedYourSkills] = useState(false);
  const [collapsedExampleSkills, setCollapsedExampleSkills] = useState(false);

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
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('capabilities.skills')}
        </div>
        <div className="flex items-center gap-sm">
          <SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('capabilities.search-skills')}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUploadDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            <span>{t('capabilities.add')}</span>
          </Button>
        </div>
      </div>

      {/* Your Skills Section */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between py-2">
          <span className="text-body-md font-bold text-text-body">
            {t('capabilities.your-skills')}
          </span>
          <Button
            variant="ghost"
            size="md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCollapsedYourSkills((c) => !c);
            }}
          >
            {collapsedYourSkills ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>
        {!collapsedYourSkills && (
          <>
            {yourSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-secondary py-8 text-center">
                <p className="text-body-sm text-text-label">
                  {searchQuery
                    ? t('capabilities.no-skills-found')
                    : t('capabilities.no-your-skills')}
                </p>
                {!searchQuery && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => setUploadDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4" />
                    {t('capabilities.add-your-first-skill')}
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                {yourSkills.map((skill) => (
                  <SkillListItem
                    key={skill.id}
                    skill={skill}
                    onDelete={() => handleDeleteClick(skill)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Example Skills Section */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between py-2">
          <span className="text-body-md font-bold text-text-body">
            {t('capabilities.example-skills')}
          </span>
          <Button
            variant="ghost"
            size="md"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCollapsedExampleSkills((c) => !c);
            }}
          >
            {collapsedExampleSkills ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </Button>
        </div>
        {!collapsedExampleSkills && (
          <>
            {exampleSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl bg-surface-secondary py-8 text-center">
                <p className="text-body-sm text-text-label">
                  {searchQuery
                    ? t('capabilities.no-skills-found')
                    : t('capabilities.no-example-skills')}
                </p>
              </div>
            ) : (
              <div className="flex flex-col">
                {exampleSkills.map((skill) => (
                  <SkillListItem
                    key={skill.id}
                    skill={skill}
                    onDelete={() => handleDeleteClick(skill)}
                  />
                ))}
              </div>
            )}
          </>
        )}
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
