import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Circle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface QueuedMessage {
    id: string;
    content: string;
    timestamp?: number;
}

interface QueuedBoxProps {
    queuedMessages?: QueuedMessage[];
    onRemoveQueuedMessage?: (id: string) => void;
    className?: string;
}

export function QueuedBox({ queuedMessages = [], onRemoveQueuedMessage, className }: QueuedBoxProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const hasQueued = queuedMessages.length > 0;

    if (!hasQueued) return null;

    return (
        <div className={cn("flex flex-col py-1 gap-1 items-start justify-center w-full rounded-t-2xl bg-input-bg-input border border-b-0 border-solid-80 border-input-border-default", className)}>
            {/* Queuing Header Top */}
            <div className="box-border flex gap-1 items-center px-2.5 py-0 relative w-full">
                {/* Lead Button for expand/collapse */}
                <Button
                    variant="ghost"
                    size="xs"
                    className="px-1 focus-visible:outline-none focus:ring-0"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    {isExpanded ? (
                        <ChevronUp size={16} className="text-icon-primary" />
                    ) : (
                        <ChevronDown size={16} className="text-icon-primary" />
                    )}
                </Button>

                {/* Middle - Queued Title */}
                <div className="flex-1 flex gap-0.5 items-center min-h-px min-w-px relative">
                    <div className="flex flex-col justify-center relative shrink-0 mr-1">
                        <span className="font-bold text-text-body text-xs">
                            {queuedMessages.length}
                        </span>
                    </div>
                    <div className="flex flex-col justify-center relative shrink-0">
                        <span className="font-bold text-text-body text-xs">
                            Queued Tasks
                        </span>
                    </div>
                </div>
            </div>

            {/* Header Content - Accordion Items for queued tasks */}
            <div
                className={cn(
                    "box-border flex flex-col gap-1 items-start px-2 py-0 relative w-full overflow-y-auto scrollbar-always-visible transition-all duration-200 ease-in-out",
                    isExpanded && queuedMessages.length > 0 ? "max-h-[156px] opacity-100" : "max-h-0 opacity-0"
                )}
            >
                {queuedMessages.map((msg) => (
                    <QueueingItem
                        key={msg.id}
                        content={msg.content}
                        onRemove={() => onRemoveQueuedMessage?.(msg.id)}
                    />
                ))}
            </div>
        </div>
    );
}

interface QueueingItemProps {
    content: string;
    onRemove?: () => void;
}

function QueueingItem({ content, onRemove }: QueueingItemProps) {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className="box-border flex gap-2 items-center px-1 py-1 relative w-full bg-surface-tertiary hover:bg-surface-secondary rounded-md transition-all duration-200 cursor-pointer"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div className="bg-transparent rounded-md w-5 h-5 p-0.5 flex items-center justify-center shrink-0">
                <Circle size={16} className="text-icon-secondary" />
            </div>

            <div className="flex-1 flex flex-col justify-center min-h-px min-w-px overflow-ellipsis overflow-hidden relative">
                <p className="font-normal m-0 text-xs whitespace-nowrap overflow-ellipsis overflow-hidden">
                    {content}
                </p>
            </div>

            <Button
                variant="ghost"
                size="icon"
                className={cn(
                    "rounded-md w-5 h-5 p-0.5 shrink-0 transition-all duration-200",
                    isHovered ? "opacity-100 translate-x-0 hover:bg-button-transparent-fill-hover" : "opacity-0 translate-x-2 pointer-events-none"
                )}
                onClick={(e) => {
                    e.preventDefault();
                    onRemove?.();
                }}
                aria-label="Remove queued message"
            >
                <X size={16} className="text-icon-secondary" />
            </Button>
        </div>
    );
}

export default QueuedBox;


