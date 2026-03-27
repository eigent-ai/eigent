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
import { Plus, X } from 'lucide-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
interface TaskCompletionCardProps {
  taskPrompt?: string;
  onRerun?: () => void;
  onDismiss?: () => void;
}

export const TaskCompletionCard: React.FC<TaskCompletionCardProps> = ({
  taskPrompt = '',
  onDismiss,
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
        transition={{ duration: 0.25 }}
        className="group rounded-xl bg-surface-primary p-3 relative flex w-full flex-row items-center"
      >
        {onDismiss && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            buttonRadius="full"
            buttonContent="icon-only"
            onClick={onDismiss}
            className="-top-2 -right-2 pointer-events-none absolute z-10 shrink-0 opacity-0 transition-opacity duration-200 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
            aria-label={t('chat.close')}
          >
            <X />
          </Button>
        )}
        <div
          className={`min-w-0 gap-0.5 flex w-full flex-col ${onDismiss ? 'pr-10' : ''}`}
        >
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
          className="rounded-lg h-fit"
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
