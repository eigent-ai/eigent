import { Copy, FileText, X, Image } from "lucide-react";
import { Button } from "../../ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "../../ui/popover";
import { cn } from "@/lib/utils";
import { useState, useRef, useEffect } from "react";

interface UserMessageCardProps {
	id: string;
	content: string;
	className?: string;
	attaches?: File[];
}

export function UserMessageCard({
	id,
	content,
	className,
	attaches,
}: UserMessageCardProps) {
	const [hoveredFilePath, setHoveredFilePath] = useState<string | null>(null);
		const [isRemainingOpen, setIsRemainingOpen] = useState(false);
		const hoverCloseTimerRef = useRef<number | null>(null);
		
		const handleCopy = () => {
		navigator.clipboard.writeText(content);
	};

		// Popover handles outside clicks; no manual listener needed
		const openRemainingPopover = () => {
			if (hoverCloseTimerRef.current) {
				window.clearTimeout(hoverCloseTimerRef.current);
				hoverCloseTimerRef.current = null;
			}
			setIsRemainingOpen(true);
		};

		const scheduleCloseRemainingPopover = () => {
			if (hoverCloseTimerRef.current) {
				window.clearTimeout(hoverCloseTimerRef.current);
			}
			hoverCloseTimerRef.current = window.setTimeout(() => {
				setIsRemainingOpen(false);
				hoverCloseTimerRef.current = null;
			}, 150);
		};

	const getFileIcon = (fileName: string) => {
		const ext = fileName.split(".").pop()?.toLowerCase() || "";
		if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) {
			return <Image className="w-4 h-4 text-icon-primary" />;
		}
		return <FileText className="w-4 h-4 text-icon-primary" />;
	};

	return (
		<div
			key={id}
			className={`relative bg-white-80% w-full rounded-xl border px-sm py-2 ${className || ""} group overflow-visible`}
		>
			<div className="absolute bottom-[0px] right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
				<Button onClick={handleCopy} variant="ghost" size="icon">
					<Copy />
				</Button>
			</div>
			<div className="text-text-body text-body-sm whitespace-pre-wrap break-words">
				{content}
			</div>
			{attaches && attaches.length > 0 && (
				<div className="box-border flex flex-wrap gap-1 items-start relative w-full mt-2">
					{(() => {
						// Show max 4 files + count indicator
						const maxVisibleFiles = 4;
						const visibleFiles = attaches.slice(0, maxVisibleFiles);
						const remainingCount = attaches.length > maxVisibleFiles ? attaches.length - maxVisibleFiles : 0;
						
						return (
							<>
								{visibleFiles.map((file) => {
									const isHovered = hoveredFilePath === file.filePath;
									return (
										<div
											key={"attache-" + file.fileName}
											className={cn(
												"bg-tag-surface box-border flex gap-0.5 items-center relative rounded-lg max-w-32 h-auto cursor-pointer hover:bg-tag-surface-hover transition-colors duration-300"
											)}
											onMouseEnter={() => setHoveredFilePath(file.filePath)}
											onMouseLeave={() => setHoveredFilePath((prev) => (prev === file.filePath ? null : prev))}
											onClick={(e) => {
												e.stopPropagation();
												window.ipcRenderer.invoke("reveal-in-folder", file.filePath);
											}}
										>
											{/* File icon */}
											<div className="rounded-md flex items-center justify-center w-6 h-6">
												{getFileIcon(file.fileName)}
											</div>

											{/* File Name */}
											<p
												className={cn(
													"flex-1 font-['Inter'] font-bold leading-tight min-h-px min-w-px overflow-ellipsis overflow-hidden relative text-text-body text-xs whitespace-nowrap my-0"
												)}
												title={file.fileName}
											>
												{file.fileName}
											</p>
										</div>
									);
								})}

								{/* Show remaining count if more than 4 files */}
								{remainingCount > 0 && (
									<Popover open={isRemainingOpen} onOpenChange={setIsRemainingOpen}>
										<PopoverTrigger asChild>
											<Button
												size="icon"
												variant="ghost"
												className="bg-tag-surface box-border flex items-center relative rounded-lg h-auto"
												onMouseEnter={openRemainingPopover}
												onMouseLeave={scheduleCloseRemainingPopover}
												onClick={(e) => {
													e.stopPropagation();
												}}
											>
												<p className="font-['Inter'] font-bold leading-tight text-text-body text-xs whitespace-nowrap my-0">
													{remainingCount}+
												</p>
											</Button>
										</PopoverTrigger>
										<PopoverContent
											align="end"
											sideOffset={4}
											className="!w-auto max-w-40 p-1 rounded-md border border-dropdown-border bg-dropdown-bg shadow-perfect"
											onMouseEnter={openRemainingPopover}
											onMouseLeave={scheduleCloseRemainingPopover}
										>
											<div className="max-h-[176px] overflow-auto scrollbar-hide gap-1 flex flex-col">
												{attaches.slice(maxVisibleFiles).map((file) => {
													const isHovered = hoveredFilePath === file.filePath;
													return (
														<div
															key={file.filePath}
															className="flex items-center gap-1 py-0.5 bg-tag-surface hover:bg-tag-surface-hover transition-colors duration-300 cursor-pointer rounded-lg"
															onMouseLeave={() => setHoveredFilePath((prev) => (prev === file.filePath ? null : prev))}
															onClick={(e) => {
																e.stopPropagation();
																window.ipcRenderer.invoke("reveal-in-folder", file.filePath);
																setIsRemainingOpen(false);
															}}
														>
															<div className="rounded-md flex items-center justify-center w-6 h-6">
																{getFileIcon(file.fileName)}
															</div>
															<p className="flex-1 font-['Inter'] font-bold leading-tight text-text-body text-xs whitespace-nowrap my-0 overflow-hidden text-ellipsis">
																{file.fileName}
															</p>
														</div>
													);
												})}
											</div>
										</PopoverContent>
									</Popover>
								)}
							</>
						);
					})()}
				</div>
			)}
		</div>
	);
}

