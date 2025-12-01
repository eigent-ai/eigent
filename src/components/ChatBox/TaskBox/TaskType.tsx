import { useTranslation } from "react-i18next";
export const TaskType = ({ type }: { type: 1 | 2 | 3 }) => {
	const { t } = useTranslation();
	const typeMap = {
		1: {
			label: t("layout.task-splitting"),
			textColor: "text-badge-splitting-surface-foreground",
			bgColor: "bg-badge-splitting-surface",
			dotColor: "bg-badge-splitting-surface-foreground",
		},
		2: {
			label: t("layout.task-running"),
			textColor: "text-text-success-primary",
			bgColor: "bg-bg-fill-success-secondary",
			dotColor: "bg-text-success-primary",
		},
		3: {
			label: t("layout.task-completed"),
			textColor: "text-text-primary",
			bgColor: "bg-transparent",
			dotColor: "bg-text-primary",
		},
	};
	return (
		<div
			className={`h-6  flex items-center gap-1 px-2 py-1 rounded-full ${typeMap[type].bgColor} ${typeMap[type].textColor} font-medium leading-17 text-xs`}
		>
			<div className={`w-2 h-2 ${typeMap[type].dotColor} rounded-full`}></div>
			<span>{typeMap[type].label}</span>
		</div>
	);
};
