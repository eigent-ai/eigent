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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
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
      toast.success(t('capabilities.skill-deleted-success'));
    }
    onConfirm();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent size="sm" showCloseButton onClose={onCancel}>
        <DialogHeader title={t('capabilities.delete-skill')} />
        <DialogContentSection>
          <p className="text-body-sm text-text-body">
            {t('capabilities.delete-skill-confirmation', {
              name: skill?.name || '',
            })}
          </p>
        </DialogContentSection>
        <DialogFooter
          showCancelButton
          showConfirmButton
          cancelButtonText={t('layout.cancel')}
          confirmButtonText={t('layout.delete')}
          confirmButtonVariant="cuation"
          onCancel={onCancel}
          onConfirm={handleDelete}
        />
      </DialogContent>
    </Dialog>
  );
}
