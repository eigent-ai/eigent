import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger?: React.ReactNode;
	onConfirm: () => void;
}

export default function EndNoticeDialog({ open, onOpenChange, trigger, onConfirm }: Props) {
	const { t } = useTranslation();
	const onSubmit = useCallback(() => {
		onConfirm();
	}, [onConfirm]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent className="sm:max-w-[600px] p-0 !bg-popup-surface gap-0 !rounded-xl border border-zinc-300 shadow-sm">
				<DialogHeader className="!bg-popup-surface !rounded-t-xl p-md justify-start">
					<DialogTitle className="m-0">{t("layout.end-project")}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-md bg-popup-bg p-md">
					{t("layout.ending-this-project-will-stop")}
				</div>
				<DialogFooter className="bg-white-100% !rounded-b-xl p-md">
					<DialogClose asChild>
						<Button variant="ghost" size="md">{t("layout.cancel")}</Button>
					</DialogClose>
					<Button size="md" onClick={onSubmit} variant="cuation">{t("layout.yes-end-project")}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
