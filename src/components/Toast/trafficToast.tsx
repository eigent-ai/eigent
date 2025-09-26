import { toast } from "sonner";
import { useTranslation } from "react-i18next";
export function showTrafficToast() {
	toast.dismiss();
	const { t } = useTranslation();
	toast(
		<div>
			{t("chat.we-re-experiencing-high-traffic-please-try-again-in-a-few-moments")}
		</div>,
		{
			duration: 5000,
			closeButton: true,
		}
	);
}
