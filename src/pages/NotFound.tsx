import { useTranslation } from "react-i18next";

export default function NotFound() {
	const { t } = useTranslation();
	console.log(window.location.href)
	return <div>{t("layout.not-found")}</div>;
}

