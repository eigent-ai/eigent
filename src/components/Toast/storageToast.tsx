import { toast } from "sonner";
import { useTranslation } from "react-i18next";
export function showStorageToast() {
	toast.dismiss();
	const { t } = useTranslation();
	toast(
		<div>
			{t("chat.your-cloud-storage-has-reached-the-limit-of-your-current-plan")} Please{" "}
			<a
				className="underline cursor-pointer"
				onClick={() =>
					(window.location.href = "https://www.eigent.ai/pricing")
				}
			>
				{t("chat.upgrade")}
			</a>{" "}
			{t("chat.your-account-or-switch-to-a-self-hosted-model-and-api-in")}{" "}
		</div>,
		{
			duration: Infinity,
			closeButton: true,
		}
	);
}
