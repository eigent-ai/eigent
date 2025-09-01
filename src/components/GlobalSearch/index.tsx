import { useState } from "react";

import { Calculator, Calendar, Smile } from "lucide-react";

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

	return (
		<>
			<div
				className="h-6 bg-bg-surface-secondary flex items-center justify-center w-60 rounded-lg space-x-2 no-drag"
				onClick={() => setOpen(true)}
			>
				<Search className="w-4 h-4 text-text-secondary"></Search>
				<span className="text-text-secondary font-inter text-[10px] leading-4">
					Search for a task or document
				</span>
			</div>
			<CommandDialog open={open} onOpenChange={setOpen}>
				<DialogTitle className="sr-only">Search</DialogTitle>
				<CommandInput placeholder="Type a command or search..." />
				<CommandList>
					<CommandEmpty>No results found.</CommandEmpty>
					<CommandGroup heading="Today">
						<CommandItem>
							<Calendar />
							<span>Calendar</span>
						</CommandItem>
						<CommandItem>
							<Smile />
							<span>Search Emoji</span>
						</CommandItem>
						<CommandItem>
							<Calculator />
							<span>Calculator</span>
						</CommandItem>
					</CommandGroup>
					<CommandSeparator />
				</CommandList>
			</CommandDialog>
		</>
	);
}
