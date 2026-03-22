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

import { Input } from "@/components/ui/input";
import type { InputSize } from "@/components/ui/input";
import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface SearchInputProps {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
	placeholder?: string;
	size?: InputSize;
	leadingIcon?: ReactNode;
}

export default function SearchInput({ value, onChange, placeholder, size = "sm", leadingIcon }: SearchInputProps) {
	const { t } = useTranslation();

	return (
		<div className="relative w-full">
			<Input
				size={size}
				value={value}
				className="w-full rounded-full"
				onChange={onChange}
				placeholder={placeholder ?? t("layout.search")}
				leadingIcon={leadingIcon ?? <Search className="w-5 h-5 text-icon-secondary" />}
			/>
		</div>
	);
}
