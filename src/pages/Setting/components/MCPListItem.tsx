import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Ellipsis, Settings, Trash2, CircleAlert } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
	PopoverClose,
} from "@/components/ui/popover";
import { useState } from "react";
import type { MCPUserItem } from "./types";

interface MCPListItemProps {
	item: MCPUserItem;
	onSetting: (item: MCPUserItem) => void;
	onDelete: (item: MCPUserItem) => void;
	onSwitch: (id: number, checked: boolean) => Promise<void>;
	loading: boolean;
}

export default function MCPListItem({
	item,
	onSetting,
	onDelete,
	onSwitch,
	loading,
}: MCPListItemProps) {
	const [showMenu, setShowMenu] = useState(false);

	return (
		<div className="p-4 bg-surface-secondary rounded-2xl flex items-center justify-between gap-4 mb-4">
			<div className="flex items-center gap-xs">
				<div className="mx-xs w-3 h-3 rounded-full bg-green-500"></div>
				<div className="text-base leading-9 font-bold text-text-primary">
					{item.mcp_name}
				</div>
				<div className="flex items-center">
					<Tooltip>
						<TooltipTrigger asChild>
							<CircleAlert className="w-4 h-4 text-icon-secondary" />
						</TooltipTrigger>
						<TooltipContent>
							<div>{item.mcp_desc}</div>
						</TooltipContent>
					</Tooltip>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<Switch
					checked={item.status === 1}
					disabled={loading}
					onCheckedChange={(checked) => onSwitch(item.id, checked)}
				/>
				<div className="relative">
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setShowMenu((v) => !v)}
								disabled={loading}
							>
								<Ellipsis className="w-4 h-4 text-icon-primary" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-[98px] p-sm rounded-[12px] bg-dropdown-bg border border-solid border-dropdown-border">
							<div className="space-y-1">
								<PopoverClose asChild>
									<Button
										variant="ghost"
										size="sm"
										className="w-full"
										onClick={() => {
                      onSetting(item);
                      setShowMenu(false);
                    }}
									>
										<Settings className="w-4 h-4 mr-2 text-gray-500" /> Setting
									</Button>
								</PopoverClose>
								<PopoverClose asChild>
									<Button
										variant="ghost"
										size="sm"
										className="w-full"
										onClick={() => {
											onDelete(item);
											setShowMenu(false);
										}}
									>
										<Trash2 className="w-4 h-4 mr-2" /> Delete
									</Button>
								</PopoverClose>
							</div>
						</PopoverContent>
					</Popover>
				</div>
			</div>
		</div>
	);
}
