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

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';
import { SkillInfo } from './SkillList';

interface SkillDeleteDialogProps {
  open: boolean;
  skill: SkillInfo | null;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
}

export default function SkillDeleteDialog({
  open,
  skill,
  onClose,
  onConfirm,
  deleting,
}: SkillDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Skill</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-500" />
            <div>
              <p className="mb-1 font-medium">
                Are you sure you want to delete this skill?
              </p>
              {skill && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  <span className="font-medium">{skill.name}</span> will be
                  permanently removed.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
