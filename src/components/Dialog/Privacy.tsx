import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { proxyFetchGet, proxyFetchPut } from "@/api/http";
import { useTranslation } from "react-i18next";

interface PrivacyDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger?: React.ReactNode;
}

export function PrivacyDialog({ open, onOpenChange, trigger }: PrivacyDialogProps) {
	const { t } = useTranslation();
	const API_FIELDS = [
		"take_screenshot",
		"access_local_software",
		"access_your_address",
		"password_storage",
	];

	const [settings, setSettings] = useState([
		{
			title: t("layout.allow-agent-to-take-screenshots"),
			description: t("layout.permit-the-agent-to-capture"),
			checked: false,
		},
		{
			title: t("layout.allow-agent-to-access-local-software"),
			description: t("layout.grant-the-agent-permission"),
			checked: false,
		},
		{
			title: t("layout.allow-agent-to-access-your-address"),
			description: t("layout.authorize-the-agent-to-view"),
			checked: false,
		},
		{
			title: t("layout.password-storage"),
			description: t("layout.determine-how-passwords-are-handled"),
			checked: false,
		},
	]);

	useEffect(() => {
		proxyFetchGet("/api/user/privacy")
			.then((res) => {
				setSettings((prev) =>
					prev.map((item, index) => ({
						...item,
						checked: res[API_FIELDS[index]] || false,
					}))
				);
			})
			.catch((err) => console.error("Failed to fetch settings:", err));
	}, []);

	const handleToggle = (index: number) => {
		setSettings((prev) => {
			const newSettings = [...prev];
			newSettings[index] = {
				...newSettings[index],
				checked: !newSettings[index].checked,
			};
			return newSettings;
		});

		const requestData = {
			[API_FIELDS[0]]: settings[0].checked,
			[API_FIELDS[1]]: settings[1].checked,
			[API_FIELDS[2]]: settings[2].checked,
			[API_FIELDS[3]]: settings[3].checked,
		};

		requestData[API_FIELDS[index]] = !settings[index].checked;

		proxyFetchPut("/api/user/privacy", requestData).catch((err) =>
			console.error("Failed to update settings:", err)
		);
	};

	const handleTurnOnAll = () => {
		const newSettings = settings.map((item) => ({
			...item,
			checked: true,
		}));
		setSettings(newSettings);

		const requestData = {
			[API_FIELDS[0]]: true,
			[API_FIELDS[1]]: true,
			[API_FIELDS[2]]: true,
			[API_FIELDS[3]]: true,
		};

		proxyFetchPut("/api/user/privacy", requestData)
			.then(() => {
				onOpenChange(false);
			})
			.catch((err) => console.error("Failed to update settings:", err));
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
			<DialogContent className="sm:max-w-[600px] p-0 !bg-popup-surface gap-0 !rounded-xl border border-zinc-300 shadow-sm">
				<DialogHeader className="!bg-popup-surface !rounded-t-xl p-md">
					<DialogTitle className="m-0">
						<div className="flex items-center gap-2">
							<div className="text-base font-bold leading-10 text-text-action">
								{t("layout.turn-on-all-privacy-settings")}
							</div>
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<AlertCircle 
											size={16} 
											className="text-icon-primary cursor-pointer" 
										/>
									</TooltipTrigger>
									<TooltipContent className="max-w-[340px]">
										<p className="text-text-body text-sm">{t("layout.eigent-is-a-desktop-software")}</p>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
					</DialogTitle>
				</DialogHeader>

				<div className="flex flex-col gap-md bg-popup-bg p-md">
					{settings.map((item, index) => (
						<div
							key={item.title}
							className="flex gap-md items-start mb-4"
						>
							<div className="flex-1">
								<div className="text-sm font-bold text-text-primary mb-1">
									{item.title}
								</div>
								<div className="text-xs text-text-body">
									{item.description}
								</div>
							</div>
							<div className="flex-shrink-0">
								<Switch
									checked={item.checked}
									onCheckedChange={() => handleToggle(index)}
								/>
							</div>
						</div>
					))}
				</div>

				<DialogFooter className="bg-white-100% !rounded-b-xl p-md">
					<DialogClose asChild>
						<Button variant="ghost" size="md">
							{t("layout.cancel")}
						</Button>
					</DialogClose>
					<Button size="md" onClick={handleTurnOnAll} variant="primary">
						{t("layout.turn-on-all-and-finish")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
