import { WorkSpaceMenu } from "@/components/WorkSpaceMenu";

function BottomBar() {
	return (
		<div className="flex h-12 items-center justify-center px-2 py-1 z-50 relative">
			<WorkSpaceMenu />
		</div>
	);
}

export default BottomBar;
