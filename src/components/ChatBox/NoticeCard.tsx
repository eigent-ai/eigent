import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TaskType } from "./TaskType";
import { TaskItem } from "./TaskItem";
import ShinyText from "@/components/ui/ShinyText/ShinyText";


import { ChevronDown, SquareCode } from "lucide-react";
import { useMemo, useState, useRef, useEffect } from "react";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export function NoticeCard() {
	const [isExpanded, setIsExpanded] = useState(false);
	const contentRef = useRef<HTMLDivElement>(null);

	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	

	// when cotList is added, smooth scroll to the bottom
	useEffect(() => {
		if (!isExpanded && contentRef.current) {
			console.log("contentRef.current", contentRef.current);
			// use setTimeout to ensure DOM update is completed before scrolling
			setTimeout(() => {
				const container = contentRef.current;
				if (container) {
					container.scrollTo({
						top: container.scrollHeight,
						behavior: "smooth",
					});
				}
			}, 100);
		}
	}, [
		chatStore.tasks[chatStore.activeTaskId as string].cotList.length,
		isExpanded,
	]);

	return (
		<div>
			<div className="w-full h-auto flex flex-col gap-2 py-sm transition-all duration-300">
				<div className="w-full h-auto  backdrop-blur-[5px] rounded-xl pr-5 py-3 relative overflow-hidden">
					<div className="relative">
						<Button
							size="icon"
							variant="ghost"
							className=" absolute top-0 right-[-15px]"
							onClick={() => setIsExpanded(!isExpanded)}
						>
							<ChevronDown
								size={16}
								className={`transition-transform duration-300 ${
									isExpanded ? "rotate-180" : ""
								}`}
							/>
						</Button>
						<div
							ref={contentRef}
							className={`${
								isExpanded ? "overflow-y-auto" : "overflow-y-auto max-h-[200px]"
							} transition-all duration-300 ease-in-out scrollbar-hide relative`}
							style={{
								maskImage: isExpanded 
									? 'none' 
									: 'linear-gradient(to top, black 0%, black 40%, transparent 100%)',
								WebkitMaskImage: isExpanded 
									? 'none' 
									: 'linear-gradient(to top, black 0%, black 40%, transparent 100%)'
							}}
						>
							<div className="mt-sm flex flex-col px-2 gap-2">
								{chatStore.tasks[chatStore.activeTaskId as string].cotList.map(
									(cot: string, index: number) => {
										return (
											<div
												key={`taskList-${index}`}
												className={`rounded-lg flex gap-2  transition-all duration-300 ease-in-out animate-in fade-in-0 slide-in-from-left-2  border border-solid border-transparent cursor-pointer
												`}
											>
												<div className="m-1.5 mt-2 w-1 h-1 bg-icon-primary rounded-full"></div>
												<div className="flex-1 flex flex-col items-start justify-center text-sm leading-normal font-normal">
													{cot}
												</div>
											</div>
										);
									}
								)}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
