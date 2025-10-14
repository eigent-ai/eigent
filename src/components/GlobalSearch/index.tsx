import { useState } from "react";

import {
	Calculator,
	Calendar,
	Smile,
} from "lucide-react";

import {
	CommandItem,
	CommandList,
	CommandEmpty,
	CommandDialog,
	CommandInput,
	CommandGroup,
	CommandSeparator,
} from "@/components/ui/command";
import { DialogTitle } from "@/components/ui/dialog";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
const items = [
	"Apple",
	"Banana",
	"Orange",
	"Grape",
	"Watermelon",
	"Pineapple",
	"Mango",
	"Blueberry",
];

export function GlobalSearch() {
	const [open, setOpen] = useState(false);
	const { t } = useTranslation();
	return (
		<>
			<div
				className="h-6 bg-bg-surface-secondary flex items-center justify-center w-60 rounded-lg space-x-2 no-drag"
				onClick={() => setOpen(true)}
			>
				<Search className="w-4 h-4 text-text-secondary"></Search>
				<span className="text-text-secondary font-inter text-[10px] leading-4">
					{t("dashboard.search-for-a-task-or-document")}
				</span>
			</div>
			<CommandDialog open={open} onOpenChange={setOpen}>
				<DialogTitle className="sr-only">{t("dashboard.search")}</DialogTitle>
				<CommandInput placeholder="Type a command or search..." />
				<CommandList>
					<CommandEmpty>{t("dashboard.no-results")}</CommandEmpty>
					<CommandGroup heading="Today">
						<CommandItem>
							<Calendar />
							<span>{t("dashboard.calendar")}</span>
						</CommandItem>
						<CommandItem>
							<Smile />
							<span>{t("dashboard.search-emoji")}</span>
						</CommandItem>
						<CommandItem>
							<Calculator />
							<span>{t("dashboard.calculator")}</span>
						</CommandItem>
					</CommandGroup>
					<CommandSeparator />
				</CommandList>
			</CommandDialog>
		</>
	);
}
