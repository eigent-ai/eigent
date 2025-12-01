import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimateIcon } from "@/components/animate-ui/icons/icon";
import { Orbit } from "@/components/animate-ui/icons/orbit";

/**
 * Variant: Splitting
 */
export interface BoxHeaderSplittingProps {
    className?: string;
}

export const BoxHeaderSplitting = ({ className }: BoxHeaderSplittingProps) => {
    return (
        <div
            className={cn(
                "flex flex-col gap-1 items-start justify-center w-full",
                className
            )}
        >
            <div className="box-border flex gap-1 items-center px-2.5 py-0 relative w-full">
                <Button
                    variant="ghost"
                    size="sm"
                    className="px-1 focus-visible:outline-none focus:ring-0"
                >
                    <AnimateIcon animate loop className="justify-center items-center h-4 w-4">
                        <Orbit size={16} className="text-icon-information" />
                    </AnimateIcon>
                </Button>

                <div className="flex-1 flex gap-0.5 items-center min-h-px min-w-px relative">
                    <span className="font-bold text-text-information text-sm whitespace-nowrap">
                        Splitting Tasks
                    </span>
                </div>
            </div>
        </div>
    );
};

/**
 * Variant: Confirm
 */
export interface BoxHeaderConfirmProps {
    subtitle?: string;
    onStartTask?: () => void;
    onEdit?: () => void;
    className?: string;
}

export const BoxHeaderConfirm = ({
    subtitle,
    onStartTask,
    onEdit,
    className,
}: BoxHeaderConfirmProps) => {
    return (
        <div
            className={cn(
                "flex flex-col gap-1 items-start justify-center w-full",
                className
            )}
        >
            <div className="box-border flex gap-1 items-center px-2.5 py-0 relative w-full">
                <Button
                    variant="ghost"
                    size="sm"
                    className="px-1 focus-visible:outline-none focus:ring-0"
                    onClick={onEdit}
                >
                    <ChevronLeft size={16} className="text-icon-primary" />
                </Button>

                <div className="flex-1 flex gap-0.5 items-center min-h-px min-w-px relative">
                    {subtitle && (
                        <div className="flex-1 flex flex-col justify-center min-h-px min-w-px overflow-ellipsis overflow-hidden relative">
                            <span className="font-normal text-text-label text-xs whitespace-nowrap overflow-ellipsis overflow-hidden m-0">
                                {subtitle}
                            </span>
                        </div>
                    )}
                </div>

                <Button
                    variant="success"
                    size="sm"
                    className="rounded-full"
                    onClick={onStartTask}
                >
                    Start Task
                </Button>
            </div>
        </div>
    );
};
