import { Button } from "@/components/ui/button";
import { Tag } from "@/components/ui/tag";
import { CirclePlay, CirclePause, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface BoxActionProps {
	/** Token count to display */
	tokens: number;
	/** Whether replay is allowed (e.g., only when task finished) */
	disabled?: boolean;
	/** Loading state for replay action */
	loading?: boolean;
	/** Callback when replay button is clicked */
	onReplay?: () => void;
	/** Optional right-side content to replace replay */
	rightContent?: React.ReactNode;
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
    tokens,
    disabled = false,
    loading = false,
    onReplay,
    rightContent,
    status,
    taskTime,
    onPauseResume,
    pauseResumeLoading = false,
    className,
}: BoxActionProps) {
    const { t } = useTranslation();

    return (
        <div className={`flex items-center justify-between gap-sm z-50 pl-4 ${className || ""}`}>
            <div className="text-text-information text-xs font-semibold leading-17">
							# {t("chat.token")} {tokens || 0}</div>
            
            <Button
                onClick={onReplay}
                disabled={disabled}
								variant="ghost"
								size="sm"
            >
              {t("chat.replay")}
            </Button>
        </div>
    );
}