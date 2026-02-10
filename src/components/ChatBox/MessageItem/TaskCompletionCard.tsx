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

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Plus, Pencil, PencilLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TriggerDialog } from '@/components/Trigger/TriggerDialog';
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
                isOpen={isTriggerDialogOpen}
                onOpenChange={setIsTriggerDialogOpen}
                initialTaskPrompt={taskPrompt}
            />
        </>
    );
};

export default TaskCompletionCard;
