import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { X, Bot, CodeXml, Globe, FileText, Image, Bird, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useWorkerList } from "@/store/authStore";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";
import { Inputbox, InputboxProps } from "./InputBox";
import { AddWorker } from "@/components/AddWorker";

/**
 * Prompt example for ActionBox
 */
interface PromptExample {
    title: string;
    prompt: string;
}

const defaultPromptExamples: PromptExample[] = [
    {
        title: "Analyze Data",
        prompt: "Analyze the data in my spreadsheet and create a summary report",
    },
    {
        title: "Write Code",
        prompt: "Write a Python script to automate file organization",
    },
    {
        title: "Research Topic",
        prompt: "Research the latest trends in AI and summarize key findings",
    },
    {
        title: "Create Document",
        prompt: "Create a project proposal document with executive summary",
    },
    {
        title: "Debug Issue",
        prompt: "Debug the authentication issue in my application",
    },
    {
        title: "Optimize Performance",
        prompt: "Optimize the database queries for better performance",
    },
];

/**
 * ExpandedInputBox Props
 */
export interface ExpandedInputBoxProps {
    /** Props to pass through to Inputbox */
    inputProps: InputboxProps;
    /** Callback when close is triggered */
    onClose?: () => void;
    /** Additional CSS classes */
    className?: string;
}

/**
 * ExpandedInputBox Component
 * 
 * A larger input panel for composing longer messages.
 * Features:
 * - BoxHeader: Shows list of agents + close button
 * - InputSection: Larger textarea
 * - ActionBox: Expandable prompt examples with horizontal scroll
 */
export const ExpandedInputBox = ({
    inputProps,
    onClose,
    className,
}: ExpandedInputBoxProps) => {
    const { t } = useTranslation();
    const { chatStore } = useChatStoreAdapter();
    const workerList = useWorkerList();
    const [agentList, setAgentList] = useState<Agent[]>([]);

    // Base workers - same as WorkSpaceMenu
    const baseWorker: Agent[] = useMemo(() => [
        {
            tasks: [],
            agent_id: "developer_agent",
            name: t("layout.developer-agent"),
            type: "developer_agent",
            log: [],
            activeWebviewIds: [],
        },
        {
            tasks: [],
            agent_id: "search_agent",
            name: t("layout.search-agent"),
            type: "search_agent",
            log: [],
            activeWebviewIds: [],
        },
        {
            tasks: [],
            agent_id: "multi_modal_agent",
            name: t("layout.multi-modal-agent"),
            type: "multi_modal_agent",
            log: [],
            activeWebviewIds: [],
        },
        {
            tasks: [],
            agent_id: "document_agent",
            name: t("layout.document-agent"),
            type: "document_agent",
            log: [],
            activeWebviewIds: [],
        },
    ], [t]);

    // Agent icon map
    const agentIconMap: Record<string, React.ReactNode> = {
        developer_agent: <CodeXml className="w-3 h-3 text-emerald-600" />,
        search_agent: <Globe className="w-3 h-3 text-blue-600" />,
        document_agent: <FileText className="w-3 h-3 text-yellow-600" />,
        multi_modal_agent: <Image className="w-3 h-3 text-fuchsia-600" />,
        social_medium_agent: <Bird className="w-3 h-3 text-purple-600" />,
    };

    // Build agent list same as WorkSpaceMenu
    useEffect(() => {
        if (!chatStore?.activeTaskId) return;
        const taskAssigning = chatStore.tasks[chatStore.activeTaskId]?.taskAssigning || [];
        const base = [...baseWorker, ...workerList].filter(
            (worker) => !taskAssigning.find((agent) => agent.type === worker.type)
        );
        setAgentList([...base, ...taskAssigning]);
    }, [
        chatStore?.tasks[chatStore?.activeTaskId as string]?.taskAssigning,
        workerList,
        baseWorker,
        chatStore?.activeTaskId,
    ]);

    const handlePromptClick = (prompt: string) => {
        inputProps.onChange?.(prompt);
    };

    // Get display agents (limit to show)
    const displayAgents = agentList.slice(0, 6);
    const remainingCount = agentList.length > 6 ? agentList.length - 6 : 0;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
                "fixed top-1/2 left-1/2 z-30",
                "min-w-[600px] max-w-[760px]",
                "bg-surface-primary backdrop-blur-md border border-border-tertiary border-solid rounded-2xl",
                "perfect-shadow",
                "flex flex-col",
                className
            )}
            style={{
                x: "-50%",
                y: "-50%",
                transformOrigin: "center center",
            }}
        >
            {/* BoxHeader */}
            <div className="flex items-center justify-between px-4 py-3 gap-4 border-b border-border-tertiary">
                {/* Agent List */}
                <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                        {displayAgents.map((agent: Agent, index: number) => (
                            <div
                                key={agent.agent_id || index}
                                className="flex items-center gap-1 px-2 py-1 rounded-full bg-surface-tertiary text-xs text-text-body"
                                title={agent.name}
                            >
                                {agentIconMap[agent.type] || <Bot className="w-3 h-3 text-icon-secondary" />}
                                <span className="max-w-20 truncate">{agent.name}</span>
                            </div>
                        ))}
                        {remainingCount > 0 && (
                            <div className="px-2 py-1 rounded-full bg-surface-tertiary text-xs text-text-label">
                                +{remainingCount}
                            </div>
                        )}
                        {agentList.length === 0 && (
                            <span className="text-xs text-text-label italic">No agents added</span>
                        )}
                        {/* Add Worker Button */}
                        <AddWorker variant="icon" />
                    </div>
                </div>

                {/* Close Button */}
                <div className="flex items-center gap-2">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-full"
                        onClick={onClose}
                    >
                        <X className="h-4 w-4 text-icon-secondary" />
                    </Button>
                </div>
            </div>

            {/* InputSection */}
            <div className="flex-1 px-4">
                <Inputbox
                    className="min-h-40"
                    {...inputProps} />
            </div>

            {/* ActionBox - Prompt Examples Always Visible */}
            <div className="border-t border-border-tertiary">
                {/* Prompt Cards - Horizontal Scroll */}
                <div className="px-4 py-3 overflow-x-auto scrollbar-hide">
                    <div className="flex gap-2">
                        {defaultPromptExamples.map((example, index) => (
                            <button
                                key={index}
                                onClick={() => handlePromptClick(example.prompt)}
                                className={cn(
                                    "flex-shrink-0 w-48 p-3 rounded-xl",
                                    "bg-surface-tertiary border border-border-tertiary",
                                    "hover:border-border-secondary hover:bg-surface-tertiary-hover",
                                    "transition-all duration-200",
                                    "text-left"
                                )}
                            >
                                <div className="text-xs font-medium text-text-body mb-1">
                                    {example.title}
                                </div>
                                <div className="text-xs text-text-label line-clamp-2">
                                    {example.prompt}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </motion.div>
    );
};
