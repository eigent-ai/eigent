import { toast } from "sonner";

export function showStorageToast() {
	toast.dismiss();

	toast(
		<div>
			Your cloud storage has reached the limit of your current plan. Please{" "}
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "https://www.eigent.ai/pricing")}
			>
				upgrade
			</a>{" "}
			your account or store your historical content locally. You've reached the
			limit of your current plan.
		</div>,
		{
			duration: Infinity,
			closeButton: true,
		},
	);
}
