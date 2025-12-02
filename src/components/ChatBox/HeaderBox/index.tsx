import { Button } from "@/components/ui/button";
import { PlayCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HeaderBoxProps {
    /** Token count to display */
    tokens: number;
    /** Task status for determining what button to show */
    status?: 'running' | 'finished' | 'pending' | 'pause';
    /** Whether replay is loading */
    replayLoading?: boolean;
    /** Callback when replay button is clicked */
    onReplay?: () => void;
    /** Optional class name */
    className?: string;
}

export function HeaderBox({
    tokens,
    status,
    replayLoading = false,
    onReplay,
    className,
}: HeaderBoxProps) {
    const { t } = useTranslation();

    // Replay button only appears when task is finished
    const showReplayButton = status === 'finished';
    // Replay button is disabled when task is running or pending
    const isReplayDisabled = status === 'running' || status === 'pending' || status === 'pause';

    return (
        <div className={`w-full flex flex-row items-center justify-between p-2 ${className || ""}`}>
            <div className="flex items-center gap-md">
                <div className="text-text-body font-bold text-body-base leading-relaxed">
                    Tasks
                </div>
                <div className="text-text-information text-xs font-semibold leading-17">
                    # {t("chat.token")} {tokens || 0}
                </div>
            </div>

            {showReplayButton && (
                <Button
                    onClick={onReplay}
                    disabled={isReplayDisabled || replayLoading}
                    variant="outline"
                    size="sm"
                    className="no-drag !text-button-fill-information-foreground bg-button-fill-information font-semibold rounded-full"
                >
                    <PlayCircle />
                    {replayLoading ? t("common.loading") : t("chat.replay")}
                </Button>
            )}
        </div>
    );
}