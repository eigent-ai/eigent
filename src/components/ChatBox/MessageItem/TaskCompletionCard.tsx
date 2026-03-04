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

import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
interface TaskCompletionCardProps {
  taskPrompt?: string;
  onRerun?: () => void;
}

export const TaskCompletionCard: React.FC<TaskCompletionCardProps> = ({
  taskPrompt = '',
  onRerun,
}) => {
  const { t } = useTranslation();
  const [isTriggerDialogOpen, setIsTriggerDialogOpen] = useState(false);

  const handleAddTrigger = () => {
    setIsTriggerDialogOpen(true);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="flex w-full flex-row items-center gap-2 rounded-xl bg-surface-primary p-3"
      >
        {/* Description */}
        <div className="flex w-full flex-col">
          <div className="text-label-sm font-bold leading-normal text-text-body">
            {t('chat.task-completed-card-title')}
          </div>
          <div className="text-label-sm font-medium leading-normal text-text-label">
            {t('chat.task-completed-card-subtitle')}
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleAddTrigger}
          className="h-fit rounded-lg"
        >
          <Plus className="h-4 w-4" />
          {t('triggers.add-trigger')}
        </Button>
      </motion.div>

      {/* Trigger Dialog */}
      <TriggerDialog
        selectedTrigger={null}
        isOpen={isTriggerDialogOpen}
        onOpenChange={setIsTriggerDialogOpen}
        initialTaskPrompt={taskPrompt}
      />
    </>
  );
};

export default TaskCompletionCard;
