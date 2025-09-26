import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface SearchInputProps {
	value: string;
	onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function SearchInput({ value, onChange }: SearchInputProps) {
	const [isFocused, setIsFocused] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const { t } = useTranslation();
	return (
		<div className="relative w-full">
			<Input
				ref={inputRef}
				value={value}
				onChange={onChange}
				onFocus={() => setIsFocused(true)}
				onBlur={() => setIsFocused(false)}
				className="h-6 pl-12 pr-4 py-2 bg-bg-surface-tertiary rounded-[24px] border-none shadow-none focus-visible:ring-0 focus-visible:ring-transparent focus-visible:border-none text-gray-900"
				style={{ textAlign: value || isFocused ? "left" : "center" }}
			/>
			{/* placeholder */}
			{!value && !isFocused && (
				<span className="pointer-events-none absolute inset-0 flex items-center justify-center text-text-secondary select-none">
					<Search className="w-4 h-4 mr-2 text-icon-secondary" />
					<span className="text-xs leading-none text-text-body">
						{t("setting.search-mcp")}
					</span>
				</span>
			)}

			{(value || isFocused) && (
				<span className="absolute left-4 top-[calc(50%+4px)] -translate-y-1/2 text-icon-secondary">
					<Search className="w-5 h-5" />
				</span>
			)}
		</div>
	);
}
