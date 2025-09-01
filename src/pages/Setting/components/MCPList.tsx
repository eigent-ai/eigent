import MCPListItem from "./MCPListItem";
import type { MCPUserItem } from "./types";

interface MCPListProps {
	items: MCPUserItem[];
	onSetting: (item: MCPUserItem) => void;
	onDelete: (item: MCPUserItem) => void;
	onSwitch: (id: number, checked: boolean) => Promise<void>;
	switchLoading: Record<number, boolean>;
}

export default function MCPList({
	items,
	onSetting,
	onDelete,
	onSwitch,
	switchLoading,
}: MCPListProps) {
	return (
		<div className="pt-4">
			{items.map((item) => (
				<MCPListItem
					key={item.mcp_id}
					item={item}
					onSetting={onSetting}
					onDelete={onDelete}
					onSwitch={onSwitch}
					loading={!!switchLoading[item.id]}
				/>
			))}
		</div>
	);
}
