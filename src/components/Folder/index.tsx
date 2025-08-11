import { useEffect, useState } from "react";
import {
	ChevronsLeft,
	Search,
	FileText,
	CodeXml,
	ChevronLeft,
	Download,
	Folder as FolderIcon,
	ChevronRight,
	ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { useChatStore } from "@/store/chatStore";
import { MarkDown } from "@/components/ChatBox/MarkDown";
import { useAuthStore } from "@/store/authStore";
import { proxyFetchGet } from "@/api/http";

// Type definitions
interface FileTreeNode {
	name: string;
	path: string;
	type?: string;
	isFolder?: boolean;
	icon?: React.ElementType;
	children?: FileTreeNode[];
	isRemote?: boolean;
}

interface FileInfo {
	name: string;
	path: string;
	type: string;
	isFolder?: boolean;
	icon?: React.ElementType;
	content?: string;
	relativePath?: string;
	isRemote?: boolean;
}

// FileTree component to render nested file structure
interface FileTreeProps {
	node: FileTreeNode;
	level?: number;
	selectedFile: FileInfo | null;
	expandedFolders: Set<string>;
	onToggleFolder: (path: string) => void;
	onSelectFile: (file: FileInfo) => void;
	isShowSourceCode: boolean;
}

const FileTree: React.FC<FileTreeProps> = ({
	node,
	level = 0,
	selectedFile,
	expandedFolders,
	onToggleFolder,
	onSelectFile,
	isShowSourceCode,
}) => {
	if (!node.children || node.children.length === 0) return null;

	return (
		<div className={level > 0 ? "ml-4" : ""}>
			{node.children.map((child) => {
				const isExpanded = expandedFolders.has(child.path);
				const fileInfo: FileInfo = {
					name: child.name,
					path: child.path,
					type: child.type || "",
					isFolder: child.isFolder,
					icon: child.icon,
					isRemote: child.isRemote,
				};

				return (
					<div key={child.path}>
						<button
							onClick={() => {
								if (child.isFolder) {
									onToggleFolder(child.path);
								} else {
									onSelectFile(fileInfo);
								}
							}}
							className={`w-full flex items-center gap-2 p-2 text-sm rounded-md bg-transparent text-primary hover:bg-white-50 transition-colors text-left ${
								selectedFile?.path === child.path && "bg-white-50"
							}`}
						>
							{child.isFolder && (
								<span className="w-4 h-4 flex items-center justify-center">
									{isExpanded ? (
										<ChevronDown className="w-4 h-4" />
									) : (
										<ChevronRight className="w-4 h-4" />
									)}
								</span>
							)}
							{!child.isFolder && <span className="w-4" />}

							{child.isFolder ? (
								<FolderIcon className="w-5 h-5 flex-shrink-0 text-yellow-600" />
							) : child.icon ? (
								<child.icon className="w-5 h-5 flex-shrink-0" />
							) : (
								<FileText className="w-5 h-5 flex-shrink-0" />
							)}

							<span
								className={`truncate text-[13px] leading-5 ${
									child.isFolder ? "font-semibold" : "font-medium"
								}`}
							>
								{child.name}
							</span>
						</button>

						{child.isFolder && isExpanded && child.children && (
							<FileTree
								node={child}
								level={level + 1}
								selectedFile={selectedFile}
								expandedFolders={expandedFolders}
								onToggleFolder={onToggleFolder}
								onSelectFile={onSelectFile}
								isShowSourceCode={isShowSourceCode}
							/>
						)}
					</div>
				);
			})}
		</div>
	);
};

function downloadByBrowser(url: string) {
	window.ipcRenderer
		.invoke("download-file", url)
		.then((result) => {
			if (result.success) {
				console.log("download-file success:", result.path);
			} else {
				console.error("download-file error:", result.error);
			}
		})
		.catch((error) => {
			console.error("download-file error:", error);
		});
}

export default function Folder({ data }: { data?: Agent }) {
	const chatStore = useChatStore();
	const authStore = useAuthStore();
	const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
	const [loading, setLoading] = useState(false);

	const selecetdFileChange = (file: FileInfo, isShowSourceCode?: boolean) => {
		if (file.type === "zip") {
			// if file is remote, don't call reveal-in-folder
			if (file.isRemote) {
				downloadByBrowser(file.path);
				return;
			}
			window.ipcRenderer.invoke("reveal-in-folder", file.path);
			return;
		}
		// Don't open folders in preview - they are handled by expand/collapse
		if (file.isFolder) {
			return;
		}
		setSelectedFile(file);
		setLoading(true);
		console.log("file", JSON.parse(JSON.stringify(file)));

		// all files call open-file interface, the backend handles download and parsing
		window.ipcRenderer
			.invoke("open-file", file.type, file.path, isShowSourceCode)
			.then((res) => {
				setSelectedFile({ ...file, content: res });
				setLoading(false);
			})
			.catch((error) => {
				console.error("open-file error:", error);
				setLoading(false);
			});
	};

	const [isShowSourceCode, setIsShowSourceCode] = useState(false);
	const isShowSourceCodeChange = () => {
		// all files can reload content
		selecetdFileChange(selectedFile!, !isShowSourceCode);
		setIsShowSourceCode(!isShowSourceCode);
	};

	const [isCollapsed, setIsCollapsed] = useState(false);

	// Build tree structure from flat file list
	const buildFileTree = (files: FileInfo[]): FileTreeNode => {
		const root: FileTreeNode = {
			name: "root",
			path: "",
			children: [],
			isFolder: true,
		};

		// Create a map for quick access
		const nodeMap = new Map<string, FileTreeNode>();
		nodeMap.set("", root);

		// Sort files so folders come before files and by path depth
		const sortedFiles = [...files].sort((a, b) => {
			const depthA = (a.relativePath || "").split("/").filter(Boolean).length;
			const depthB = (b.relativePath || "").split("/").filter(Boolean).length;
			return depthA - depthB;
		});
		for (const file of sortedFiles) {
			const parentPath = file.relativePath || "";
			const parentNode = nodeMap.get(parentPath) || root;

			const node: FileTreeNode = {
				name: file.name,
				path: file.path,
				type: file.type,
				isFolder: file.isFolder,
				icon: file.icon,
				children: file.isFolder ? [] : undefined,
				isRemote: file.isRemote,
			};

			parentNode.children!.push(node);

			if (file.isFolder) {
				const folderPath = parentPath
					? `${parentPath}/${file.name}`
					: file.name;
				nodeMap.set(folderPath, node);
			}
		}

		return root;
	};

	const [fileTree, setFileTree] = useState<FileTreeNode>({
		name: "root",
		path: "",
		children: [],
		isFolder: true,
	});

	const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
		new Set()
	);

	const toggleFolder = (folderPath: string) => {
		setExpandedFolders((prev) => {
			const newSet = new Set(prev);
			if (newSet.has(folderPath)) {
				newSet.delete(folderPath);
			} else {
				newSet.add(folderPath);
			}
			return newSet;
		});
	};

	const [fileGroups, setFileGroups] = useState<
		{
			folder: string;
			files: FileInfo[];
		}[]
	>([
		{
			folder: "Reports",
			files: [],
		},
	]);
	useEffect(() => {
		const setFileList = async () => {
			let res = null;
			res = await window.ipcRenderer.invoke(
				"get-file-list",
				authStore.email,
				chatStore.activeTaskId as string
			);
			let tree: any = null;
			if ((res && res.length > 0) || import.meta.env.DEV) {
				tree = buildFileTree(res || []);
			} else {
				res = await proxyFetchGet("/api/chat/files", {
					task_id: chatStore.activeTaskId as string,
				});
				console.log("res", res);
				res = res.map((item: any) => {
					return {
						name: item.filename,
						type: item.filename.split(".")[1],
						path: item.url,
						isRemote: true,
					};
				});
				tree = buildFileTree(res || []);
			}
			setFileTree(tree);
			// Keep the old structure for compatibility
			setFileGroups((prev) => {
				const chatStoreSelectedFile = chatStore.tasks[chatStore.activeTaskId as string]?.selectedFile;
				if (chatStoreSelectedFile) {
					console.log(res,chatStoreSelectedFile)
					const file = res.find((item: any) => item.name === chatStoreSelectedFile.name);
					console.log("file", file);
					if(file){
						selecetdFileChange(file as FileInfo,isShowSourceCode);
					}
				}
				return [
					{
						...prev[0],
						files: res || [],
					},
				];
			});
			// if (chatStore.tasks[chatStore.activeTaskId as string]?.selectedFile) {
			// 	selecetdFileChange(
			// 		chatStore.tasks[chatStore.activeTaskId as string]
			// 			.selectedFile as FileInfo
			// 	);
			// }
		};
		setFileList();
	}, [data, chatStore.tasks[chatStore.activeTaskId as string]?.taskAssigning]);
	const handleBack = () => {
		chatStore.setActiveWorkSpace(chatStore.activeTaskId as string, "workflow");
	};

	return (
		<div className="h-full w-full flex overflow-hidden">
			{/* fileList */}
			<div
				className={`${
					isCollapsed ? "w-16" : "w-64"
				} border-[0px] border-r border-r-zinc-200 border-zinc-300 !border-solid flex flex-col transition-all duration-300 ease-in-out flex-shrink-0`}
			>
				{/* head */}
				<div
					className={` py-2 border-b border-zinc-200 flex-shrink-0 ${
						isCollapsed ? "px-2" : "pl-4 pr-2"
					}`}
				>
					<div className="flex items-center justify-between">
						{!isCollapsed && (
							<div className="flex items-center gap-2">
								<Button
									onClick={handleBack}
									size="sm"
									variant="ghost"
									className={`flex items-center gap-2`}
								>
									<ChevronLeft />
								</Button>
								<span className="text-xl font-bold text-primary whitespace-nowrap">
									Agent Folder
								</span>
							</div>
						)}
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setIsCollapsed(!isCollapsed)}
							className={`${
								isCollapsed ? "w-full" : ""
							} flex items-center justify-center`}
							title={isCollapsed ? "open" : "close"}
						>
							<ChevronsLeft
								className={`w-6 h-6 text-zinc-500 ${
									isCollapsed ? "rotate-180" : ""
								} transition-transform ease-in-out`}
							/>
						</Button>
					</div>
				</div>

				{/* Search Input*/}
				{!isCollapsed && (
					<div className="px-2 border-b border-zinc-200 flex-shrink-0">
						<div className="relative">
							<Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-primary" />
							<input
								type="text"
								placeholder="Search"
								className="w-full pl-9 pr-2 py-2 text-sm border border-zinc-200 rounded-md border-solid focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
					</div>
				)}

				{/* fileList */}
				<div className="flex-1 overflow-y-auto min-h-0">
					{!isCollapsed ? (
						<div className="p-2">
							<div className="mb-2">
								<div className="text-primary text-[10px] leading-4 font-bold px-2 py-1">
									Files
								</div>
								<FileTree
									node={fileTree}
									selectedFile={selectedFile}
									expandedFolders={expandedFolders}
									onToggleFolder={toggleFolder}
									onSelectFile={(file) =>
										selecetdFileChange(file, isShowSourceCode)
									}
									isShowSourceCode={isShowSourceCode}
								/>
							</div>
						</div>
					) : (
						// Display simplified file icons when collapsed
						<div className="p-2 space-y-2">
							{fileGroups.map((group) =>
								group.files.map((file) => (
									<button
										key={file.name}
										onClick={() => selecetdFileChange(file, isShowSourceCode)}
										className={`w-full flex items-center justify-center p-2 rounded-md hover:bg-zinc-100 transition-colors ${
											selectedFile?.name === file.name
												? "bg-blue-50 text-blue-700"
												: "text-zinc-600"
										}`}
										title={file.name}
									>
										{file.icon ? (
											<file.icon className="w-4 h-4" />
										) : (
											<FileText className="w-4 h-4" />
										)}
									</button>
								))
							)}
						</div>
					)}
				</div>
			</div>

			{/* content */}
			<div className="flex-1 flex flex-col min-w-0 overflow-hidden">
				{/* head */}
				{selectedFile && (
					<div className="p-4 border-b border-zinc-200 flex-shrink-0">
						<div className="flex items-center justify-between gap-2">
							<div
								onClick={() => {
									// if file is remote, don't call reveal-in-folder
									if (selectedFile.isRemote) {
										downloadByBrowser(selectedFile.path);
										return;
									}
									window.ipcRenderer.invoke(
										"reveal-in-folder",
										selectedFile.path
									);
								}}
								className="flex-1 min-w-0 overflow-hidden cursor-pointer flex items-center gap-2"
							>
								<span className="block text-[15px] leading-[22px] font-medium text-primary overflow-hidden text-ellipsis whitespace-nowrap">
									{selectedFile.name}
								</span>
								<Button size="icon" variant="ghost">
									<Download className="w-4 h-4 text-zinc-500" />
								</Button>
							</div>
							<Button
								variant="ghost"
								size="icon"
								className=" flex-shrink-0"
								onClick={() => isShowSourceCodeChange()}
							>
								<CodeXml className="w-4 h-4 text-zinc-500" />
							</Button>
						</div>
					</div>
				)}

				{/* content */}
				<div className="flex-1 overflow-y-auto min-h-0">
					<div className="p-6 h-full">
						{selectedFile ? (
							!loading ? (
								selectedFile.type === "md" && !isShowSourceCode ? (
									<div className="prose prose-sm max-w-none">
										<MarkDown
											content={selectedFile.content || ""}
											enableTypewriter={false}
										/>
									</div>
								) : selectedFile.type === "pdf" ? (
									<iframe
										src={
											"localfile://" +
											encodeURIComponent(selectedFile.content as string)
										}
										className="w-full h-full border-0"
										title={selectedFile.name}
									/>
								) : ["csv", "doc", "docx", "pptx", "xlsx"].includes(
										selectedFile.type
								  ) ? (
									<div
										className="w-full overflow-auto"
										dangerouslySetInnerHTML={{
											__html: selectedFile.content || "",
										}}
									/>
								) : selectedFile.type === "html" ? (
									isShowSourceCode ? (
										<>{selectedFile.content}</>
									) : (
										<iframe
											src={
												"localfile://" +
												encodeURIComponent(selectedFile.content as string)
											}
											className="w-full h-full border-0"
											title={selectedFile.name}
										/>
									)
								) : selectedFile.type === "zip" ? (
									<div className="flex items-center justify-center h-full text-zinc-500">
										<div className="text-center">
											<FileText className="w-12 h-12 mx-auto mb-4 text-zinc-300" />
											<p className="text-sm">Zip file is not supported yet.</p>
										</div>
									</div>
								) : [
										"png",
										"jpg",
										"jpeg",
										"gif",
										"bmp",
										"webp",
										"svg",
								  ].includes(selectedFile.type.toLowerCase()) ? (
									<div className="flex items-center justify-center h-full">
										<img
											src={
												selectedFile.isRemote
													? "localfile://" +
													  encodeURIComponent(selectedFile.content as string)
													: `localfile://${encodeURIComponent(
															selectedFile.path
													  )}`
											}
											alt={selectedFile.name}
											className="max-w-full max-h-full object-contain"
										/>
									</div>
								) : (
									<pre className="text-sm text-zinc-700 font-mono whitespace-pre-wrap break-words overflow-x-auto">
										{selectedFile.content}
									</pre>
								)
							) : (
								<div className="flex items-center justify-center h-full">
									<div className="text-center">
										<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
										<p className="text-sm text-zinc-500">Loading...</p>
									</div>
								</div>
							)
						) : (
							<div className="flex items-center justify-center h-full text-zinc-500">
								<div className="text-center">
									<FileText className="w-12 h-12 mx-auto mb-4 text-zinc-300" />
									<p className="text-sm">Select a file to view its contents</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
