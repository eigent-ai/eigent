import { toast } from "sonner";
import i18n from "@/i18n";

export function showCreditsToast() {
	toast.dismiss();
	toast(
		<div>
			{i18n.t("chat.you-ve-reached-the-limit-of-your-current-plan")}
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "https://www.eigent.ai/pricing")}
			>
				{i18n.t("chat.upgrade")}
			</a>{" "}
			{i18n.t("chat.your-account-or-switch-to-a-self-hosted-model-and-api-in")}{" "}
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "#/setting/general")}
			>
				{i18n.t("chat.settings")}
			</a>{" "}
			.
		</div>,
		{
			duration: Infinity,
			closeButton: true,
		}
	);
}
