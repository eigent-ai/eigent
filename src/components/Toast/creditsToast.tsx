import { toast } from "sonner";
import { useTranslation } from "react-i18next";
export function showCreditsToast() {
	toast.dismiss();
	const { t } = useTranslation();
	toast(
		<div>
			{t("chat.you-ve-reached-the-limit-of-your-current-plan")}
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "https://www.eigent.ai/pricing")}
			>
				{t("chat.upgrade")}
			</a>{" "}
			{t("chat.your-account-or-switch-to-a-self-hosted-model-and-api-in")}{" "}
			<a
				className="underline cursor-pointer"
				onClick={() => (window.location.href = "#/setting/general")}
			>
				{t("chat.settings")}
			</a>{" "}
			.
		</div>,
		{
			duration: Infinity,
			closeButton: true,
		}
	);
}
