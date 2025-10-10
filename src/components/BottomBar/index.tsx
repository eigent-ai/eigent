import { WorkSpaceMenu } from "@/components/WorkSpaceMenu";

function BottomBar() {
	return (
		<div className="flex h-12 items-center justify-center pb-2 z-50 relative">
			<WorkSpaceMenu />
		</div>
	);
}

export default BottomBar;
