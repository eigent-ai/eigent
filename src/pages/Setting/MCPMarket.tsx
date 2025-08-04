import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectTrigger,
	SelectContent,
	SelectItem,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { MCPEnvDialog } from "./components/MCPEnvDialog";
import { Plus, Store, CircleAlert, ArrowLeft, ChevronLeft } from "lucide-react";
import { proxyFetchDelete, proxyFetchGet, proxyFetchPost } from "@/api/http";
import { Input } from "@/components/ui/input";
import githubIcon from "@/assets/github.svg";
import { useAuthStore } from "@/store/authStore";
import SearchInput from "@/components/SearchInput";

interface MCPItem {
	id: number;
	name: string;
	key: string;
	description: string;
	status: number | string;
	category?: { name: string };
	home_page?: string;
	install_command?: {
		command: string;
		args: string[];
		env?: Record<string, string>;
	};
	homepage?: string;
}
interface EnvValue {
	value: string;
	required: boolean;
	tip: string;
}

const PAGE_SIZE = 10;
const STICKY_Z = 20;

function useDebounce<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const handler = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(handler);
	}, [value, delay]);
	return debounced;
}

// map category name to svg file name
const categoryIconMap: Record<string, string> = {
	anthropic: "Anthropic",
	community: "Community",
	official: "Official",
	camel: "Camel",
};

// load all svg files dynamically
const svgIcons = import.meta.glob("@/assets/mcp/*.svg", {
	eager: true,
	query: "?url",
	import: "default",
});

export default function MCPMarket({ onBack }: { onBack?: () => void }) {
	const { checkAgentTool } = useAuthStore();
	const [items, setItems] = useState<MCPItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(true);
	const [keyword, setKeyword] = useState("");
	const debouncedKeyword = useDebounce(keyword, 400);
	const loader = useRef<HTMLDivElement | null>(null);
	const [installing, setInstalling] = useState<{ [id: number]: boolean }>({});
	const [installed, setInstalled] = useState<{ [id: number]: boolean }>({});
	const [installedIds, setInstalledIds] = useState<number[]>([]);
	const [mcpCategory, setMcpCategory] = useState<
		{ id: number; name: string }[]
	>([]);

	// environment variable configuration
	const [showEnvConfig, setShowEnvConfig] = useState(false);
	const [activeMcp, setActiveMcp] = useState<MCPItem | null>(null);

	const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
	const [userInstallMcp, setUserInstallMcp] = useState<any | undefined>([]);
	// get installed MCP list
	useEffect(() => {
		proxyFetchGet("/api/mcp/users").then((res) => {
			let ids: number[] = [];
			if (Array.isArray(res)) {
				setUserInstallMcp(res);
				ids = res.map((item: any) => item.mcp_id);
			} else if (Array.isArray(res.items)) {
				setUserInstallMcp(res.items);
				ids = res.items.map((item: any) => item.mcp_id);
			}
			setInstalledIds(ids);
		});
	}, []);

	// get MCP categories
	useEffect(() => {
		proxyFetchGet("/api/mcp/categories").then((res) => {
			if (Array.isArray(res)) {
				setMcpCategory(res);
			}
		});
	}, []);

	// load data
	const loadData = useCallback(
		async (pageNum: number, kw: string, catId?: number, pageSize = 20) => {
			setIsLoading(true);
			setError("");
			try {
				const params: any = { page: pageNum, size: pageSize, keyword: kw };
				if (catId) params.category_id = catId;
				const res = await proxyFetchGet("/api/mcps", params);
				if (res && Array.isArray(res.items)) {
					// frontend deduplication
					const all: MCPItem[] =
						pageNum === 1 ? res.items : [...items, ...res.items];
					const unique: MCPItem[] = Array.from(
						new Map(all.map((i: MCPItem) => [i.id, i])).values()
					);
					setItems(unique);
					setHasMore(res.items.length === pageSize);
				} else {
					if (pageNum === 1) setItems([]);
					setHasMore(false);
				}
			} catch (err: any) {
				setError(err?.message || "Load failed");
			} finally {
				setIsLoading(false);
			}
		},
		[items]
	);

	useEffect(() => {
		setPage(1);
		loadData(1, debouncedKeyword, categoryId);
		// eslint-disable-next-line
	}, [debouncedKeyword, categoryId]);

	useEffect(() => {
		if (page > 1) loadData(page, debouncedKeyword, categoryId);
		// eslint-disable-next-line
	}, [page]);

	useEffect(() => {
		if (!hasMore || isLoading) return;
		const node = loader.current;
		if (!node) return;
		const observer = new window.IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) {
					setPage((p) => (isLoading || !hasMore ? p : p + 1));
				}
			},
			{ root: null, rootMargin: "0px", threshold: 0.1 }
		);
		observer.observe(node);
		return () => {
			observer.disconnect();
		};
	}, [hasMore, isLoading]);

	const checkEnv = (id: number) => {
		const mcp = items.find((mcp) => mcp.id === id);
		if (mcp && Object.keys(mcp?.install_command?.env || {}).length > 0) {
			setActiveMcp(mcp);
			setShowEnvConfig(true);
		} else {
			installMcp(id);
		}
	};
	const onConnect = (mcp: MCPItem) => {
		console.log(mcp);
		setItems((prev) =>
			prev.map((item) => (item.id === mcp.id ? { ...item, ...mcp } : item))
		);
		installMcp(mcp.id);
		onClose();
	};
	const onClose = () => {
		setShowEnvConfig(false);
		setActiveMcp(null);
	};
	const installMcp = async (id: number) => {
		setInstalling((prev) => ({ ...prev, [id]: true }));
		try {
			const mcpItem = items.find((item) => item.id === id);
			const res = await proxyFetchPost("/api/mcp/install?mcp_id=" + id);
			if (res) {
				console.log(res);
				setUserInstallMcp((prev: any) => [...prev, res]);
			}
			setInstalled((prev) => ({ ...prev, [id]: true }));
			setInstalledIds((prev) => [...prev, id]);
			// notify main process
			if (window.ipcRenderer && mcpItem) {
				await window.ipcRenderer.invoke(
					"mcp-install",
					mcpItem.key,
					mcpItem.install_command
				);
			}
		} catch (e) {
		} finally {
			setInstalling((prev) => ({ ...prev, [id]: false }));
		}
	};

	const handleBack = () => {
		if (onBack) onBack();
		else window.history.back();
	};

	const handleDelete = async (deleteTarget: MCPItem) => {
		if (!deleteTarget) return;
		try {
			checkAgentTool(deleteTarget.name);
			console.log(userInstallMcp, deleteTarget);
			const id = userInstallMcp.find(
				(item: any) => item.mcp_id === deleteTarget.id
			)?.id;
			console.log("deleteTarget", deleteTarget);
			await proxyFetchDelete(`/api/mcp/users/${id}`);
			// notify main process
			if (window.ipcRenderer) {
				await window.ipcRenderer.invoke("mcp-remove", deleteTarget.key);
			}
			setInstalledIds((prev) =>
				prev.filter((item) => item !== deleteTarget.id)
			);
			setInstalled((prev) => ({ ...prev, [deleteTarget.id]: false }));
			loadData(1, debouncedKeyword, categoryId, page * 20);
		} catch (e) {
			console.log(e);
		}
	};
	return (
		<div className="w-full h-full flex flex-col items-center ">
			{/* MCP Market top panel sticky */}
			<div
				className="w-full h-10 text-body flex flex-row items-center justify-between sticky top-0 z-[20]  backdrop-blur border-b mb-4 max-w-4xl"
			>
				<div className="flex items-center">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleBack}
						className="mr-2"
					>
						<ChevronLeft className="w-6 h-6 bg-button-transparent-fill-default/0 rounded-md" />
					</Button>
					<span className="text-lg font-bold leading-snug text-text-primary">
						MCP Market
					</span>
				</div>
				<div className="flex items-center">
					<Select
						value={categoryId ? String(categoryId) : ""}
						onValueChange={(val) =>
							setCategoryId(val ? Number(val) : undefined)
						}
					>
						<SelectTrigger className="min-w-32 h-6">
							<SelectValue placeholder="All" />
						</SelectTrigger>
						<SelectContent className="bg-white-100% px-2 py-1 rounded overflow-hidden">
							<SelectItem
								value="all"
								className="leading-none text-xs font-bold text-button-tertiery-text-default"
							>
								<span>All</span>
							</SelectItem>
							{mcpCategory.map((cat) => {
								const iconKey = categoryIconMap[cat.name];
								const iconUrl = iconKey
									? (svgIcons[`/src/assets/mcp/${iconKey}.svg`] as string)
									: "";
								return (
									<SelectItem key={cat.id} value={String(cat.id)}>
										<span
											style={{ display: "inline-flex", alignItems: "center" }}
										>
											{iconUrl && (
												<img
													src={iconUrl}
													alt={cat.name}
													style={{
														width: 16,
														height: 16,
														marginRight: 6,
														display: "inline-block",
														verticalAlign: "middle",
													}}
												/>
											)}
											{cat.name}
										</span>
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</div>
			</div>
			{/* search mcp input sticky */}
			<div className="sticky top-[48px] z-[19] w-full max-w-4xl bg-white/80 backdrop-blur border-b mb-2">
				<div className="flex items-center gap-2 px-2">
					<SearchInput
						value={keyword}
						onChange={(e) => setKeyword(e.target.value)}
					></SearchInput>
				</div>
			</div>

			{/* list */}
			<MCPEnvDialog
				showEnvConfig={showEnvConfig}
				onClose={onClose}
				onConnect={onConnect}
				activeMcp={activeMcp}
			></MCPEnvDialog>
			<div className="space-y-md w-full max-w-4xl overflow-y-auto scrollbar">
				{isLoading && items.length === 0 && (
					<div className="text-center py-8 text-gray-400">Loading...</div>
				)}
				{error && <div className="text-center py-8 text-red-500">{error}</div>}
				{!isLoading && !error && items.length === 0 && (
					<div className="text-center py-8 text-gray-400">No MCP services</div>
				)}
				{items.map((item) => (
					<div
						key={item.id}
						className="p-4 bg-bg-surface-tertiary rounded-2xl flex items-center"
					>
						{/* Left: Icon */}
						<div className="flex items-center mr-4">
							{(() => {
								const catName = item.category?.name;
								const iconKey = catName ? categoryIconMap[catName] : undefined;
								const iconUrl = iconKey
									? (svgIcons[`/src/assets/mcp/${iconKey}.svg`] as string)
									: undefined;
								return iconUrl ? (
									<img src={iconUrl} alt={catName} className="w-9 h-11" />
								) : (
									<Store className="w-9 h-11 text-icon-primary" />
								);
							})()}
						</div>
						<div className="flex-1 min-w-0 flex flex-col justify-center">
							<div className="flex items-center gap-xs w-full pb-1">
								<div className="flex items-center gap-xs flex-1">
									<span className="text-base leading-9 font-bold text-text-primary truncate ">
										{item.name}
									</span>
									<Tooltip>
										<TooltipTrigger asChild>
											<CircleAlert className="w-4 h-4 text-icon-secondary" />
										</TooltipTrigger>
										<TooltipContent>
											<div>{item.description}</div>
										</TooltipContent>
									</Tooltip>
								</div>
								<Button
									variant={
										!installedIds.includes(item.id) ? "primary" : "secondary"
									}
									size="sm"
									onClick={() =>
										installedIds.includes(item.id)
											? handleDelete(item)
											: checkEnv(item.id)
									}
								>
									{installedIds.includes(item.id)
										? "Uninstall"
										: installing[item.id]
										? "Installing..."
										: installed[item.id]
										? "Uninstall"
										: "Install"}
								</Button>
							</div>
							{item.home_page &&
								item.home_page.startsWith("https://github.com/") && (
									<div className="flex items-center">
										<img
											src={githubIcon}
											alt="github"
											style={{
												width: 14.7,
												height: 14.7,
												marginRight: 4,
												display: "inline-block",
												verticalAlign: "middle",
											}}
										/>
										<span className="self-stretch items-center justify-center text-xs font-medium leading-3">
											{(() => {
												const parts = item.home_page.split("/");
												return parts.length > 4 ? parts[4] : item.home_page;
											})()}
										</span>
									</div>
								)}
							<div className="text-sm text-gray-500 mt-1 break-words whitespace-pre-line">
								{item.description}
							</div>
						</div>
					</div>
				))}
				<div ref={loader} />
				{isLoading && items.length > 0 && (
					<div className="text-center py-4 text-gray-400">Loading more...</div>
				)}
				{!hasMore && items.length > 0 && (
					<div className="text-center py-4 text-gray-400">
						No more MCP servers
					</div>
				)}
			</div>
		</div>
	);
}
