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

import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { CirclePlay, CirclePause, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BoxActionProps {
    /** Task status for determining what button to show */
    status?: 'running' | 'finished' | 'pending' | 'pause';
    /** Task time display */
    taskTime?: string;
    /** Callback for pause/resume */
    onPauseResume?: () => void;
    /** Loading state for pause/resume */
    pauseResumeLoading?: boolean;
    className?: string;
}

export function BoxAction({
    status,
    taskTime,
    onPauseResume,
    pauseResumeLoading = false,
    className,
}: BoxActionProps) {
    const { t } = useTranslation();

    return (
        <div className={`flex items-center justify-between gap-sm z-50 pl-4 ${className || ""}`}>
            {/* Placeholder for future actions */}
            <div></div>
        </div>
    );
}