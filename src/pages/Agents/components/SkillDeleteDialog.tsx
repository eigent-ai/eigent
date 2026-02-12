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

import ConfirmModal from '@/components/ui/alertDialog';
import { useSkillsStore, type Skill } from '@/store/skillsStore';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface SkillDeleteDialogProps {
  open: boolean;
  skill: Skill | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SkillDeleteDialog({
  open,
  skill,
  onConfirm,
  onCancel,
}: SkillDeleteDialogProps) {
  const { t } = useTranslation();
  const { deleteSkill } = useSkillsStore();

  const handleDelete = () => {
    if (skill) {
      deleteSkill(skill.id);
      toast.success(t('agents.skill-deleted-success'));
    }
    onConfirm();
  };

  return (
    <ConfirmModal
      isOpen={open}
      onClose={onCancel}
      onConfirm={handleDelete}
      title={t('agents.delete-skill')}
      message={t('agents.delete-skill-confirmation', {
        name: skill?.name || '',
      })}
      confirmText={t('layout.delete')}
      cancelText={t('layout.cancel')}
      confirmVariant="cuation"
    />
  );
}
