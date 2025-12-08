import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Plus, Pencil, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
import { TriggerInput } from '@/types';
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

    const handleTriggerCreating = (triggerData: TriggerInput) => {
        // Handle trigger creation placeholder
        console.log('Creating trigger:', triggerData);
    };

    const handleTriggerCreated = (triggerData: TriggerInput) => {
        // Handle trigger created
        console.log('Trigger created:', triggerData);
        setIsTriggerDialogOpen(false);
    };

    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-surface-primary rounded-xl px-2 py-3 w-full flex flex-col gap-2"
            >
                {/* Description */}
                <div className="text-text-label text-label-sm font-medium leading-normal mb-sm">
                    {t('chat.task-complete-description', 'Task completed. You can refine the task prompt or turn it into an automated task with a trigger.')}
                </div>
                <div className="flex flex-row w-full gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRerun}
                        className="gap-1 flex-1 flex justify-center rounded-lg"
                    >
                        <PencilLine className="w-4 h-4" />
                        {t('chat.rerun', 'Re-edit')}
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleAddTrigger}
                        className="gap-1 flex-1 flex justify-center rounded-lg"
                    >
                        <Plus className="w-4 h-4" />
                        {t('triggers.add-trigger', 'Add trigger')}
                    </Button>
                </div>
            </motion.div>

            {/* Trigger Dialog */}
            <TriggerDialog
                view="create"
                selectedTrigger={null}
                onTriggerCreating={handleTriggerCreating}
                onTriggerCreated={handleTriggerCreated}
                isOpen={isTriggerDialogOpen}
                onOpenChange={setIsTriggerDialogOpen}
            />
        </>
    );
};

export default TaskCompletionCard;
