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
                className="bg-surface-primary rounded-xl p-3 w-full flex flex-row gap-2 items-center"
            >
                {/* Description */}
                <div className="flex flex-col w-full">
                    <div className="text-text-body text-label-sm font-bold leading-normal">
                        Task completed
                    </div>
                    <div className="text-text-label text-label-sm font-medium leading-normal">
                        Automate your task with a trigger
                    </div>
                </div>
                <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAddTrigger}
                    className="rounded-lg h-fit"
                >
                    <Plus className="w-4 h-4" />
                    Add trigger
                </Button>
            </motion.div>

            {/* Trigger Dialog */}
            <TriggerDialog
                selectedTrigger={null}
                onTriggerCreating={handleTriggerCreating}
                onTriggerCreated={handleTriggerCreated}
                isOpen={isTriggerDialogOpen}
                onOpenChange={setIsTriggerDialogOpen}
                initialTaskPrompt={taskPrompt}
            />
        </>
    );
};

export default TaskCompletionCard;
