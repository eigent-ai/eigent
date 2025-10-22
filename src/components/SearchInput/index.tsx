import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SearchInputProps {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function SearchInput({ value, onChange }: SearchInputProps) {
	const { t } = useTranslation();
	return (
		<div className="relative w-full">
			<Input
				size="sm"
				value={value}
				onChange={onChange}
				placeholder={t("setting.search-mcp")}
				leadingIcon={<Search className="w-5 h-5 text-icon-secondary" />}
			/>
			
		</div>
	);
}
