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
