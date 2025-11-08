import { Copy, FileText, X, Image } from "lucide-react";
import { Button } from "../../ui/button";
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
	const remainingRef = useRef<HTMLDivElement | null>(null);
	
	const handleCopy = () => {
		navigator.clipboard.writeText(content);
	};

	useEffect(() => {
		const onDocClick = (e: MouseEvent) => {
			if (!remainingRef.current) return;
			if (!remainingRef.current.contains(e.target as Node)) {
				setIsRemainingOpen(false);
			}
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, []);

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
			className={`relative bg-white-80% w-full rounded-xl border px-sm py-2 ${className || ""} group overflow-hidden`}
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
									return (
										<div
											key={"attache-" + file.fileName}
											className={cn(
												"bg-tag-surface box-border flex gap-0.5 items-center relative rounded-lg max-w-32 h-auto cursor-pointer hover:bg-tag-surface-hover transition-colors"
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
									<div ref={remainingRef} className="relative">
										<Button
											size="icon"
											variant="ghost"
											className="bg-tag-surface box-border flex items-center relative rounded-lg h-auto"
											onClick={(e) => {
												e.stopPropagation();
												setIsRemainingOpen((v) => !v);
											}}
										>
											<p className="font-['Inter'] font-bold leading-tight text-text-body text-xs whitespace-nowrap my-0">
												{remainingCount}+
											</p>
										</Button>
										{isRemainingOpen && (
											<div className="absolute left-0 mt-1 z-30 max-w-40 p-1 rounded-md border border-dropdown-border bg-dropdown-bg shadow-perfect">
												<div className="max-h-64 overflow-auto gap-1 flex flex-col">
													{attaches.slice(maxVisibleFiles).map((file) => {
														return (
															<div
																key={file.filePath}
																className="flex items-center gap-1 px-1 py-0.5 bg-tag-surface rounded-md cursor-pointer hover:bg-tag-surface-hover transition-colors"
																onMouseEnter={() => setHoveredFilePath(file.filePath)}
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
											</div>
										)}
									</div>
								)}
							</>
						);
					})()}
				</div>
			)}
		</div>
	);
}

