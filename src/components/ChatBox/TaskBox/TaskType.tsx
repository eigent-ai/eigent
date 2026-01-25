// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

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
