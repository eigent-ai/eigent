import { toast } from "sonner";

export function showCreditsToast() {
	toast.dismiss();
	
	toast(
		<div>
			You've reached the limit of your current plan.
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "https://www.eigent.ai/pricing")}
			>
				Upgrade
			</a>{" "}
			your account or switch to a self-hosted model and API in{" "}
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "#/setting/general")}
			>
				Settings
			</a>{" "}
			.
		</div>,
		{
			duration: Infinity,
			closeButton: true,
		}
	);
}
