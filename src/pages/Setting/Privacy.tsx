import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { proxyFetchGet, proxyFetchPut } from "@/api/http";
import { Button } from "@/components/ui/button";
import { FolderSearch } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

export default function SettingPrivacy() {
	const { email } = useAuthStore();
	const [_privacy, setPrivacy] = useState(false);
	const API_FIELDS = [
		"take_screenshot",
		"access_local_software",
		"access_your_address",
		"password_storage",
	];
	const [settings, setSettings] = useState([
		{
			title: "Allow Agent to Take Screenshots",
			description:
				"Permit the agent to capture screenshots of your computer screen. This can be used for support, diagnostics, or monitoring purposes. Screenshots may include visible personal information, so please enable with care.",
			checked: false,
		},
		{
			title: "Allow Agent to Access Local Software",
			description:
				"Grant the agent permission to interact with and utilize software installed on your local machine. This may be necessary for troubleshooting, running diagnostics, or performing specific tasks.",
			checked: false,
		},
		{
			title: "Allow Agent to Access Your Address",
			description:
				"Authorize the agent to view and use your location or address details. This may be required for location-based services or personalized support.",
			checked: false,
		},
		{
			title: "Password Storage",
			description:
				"Determine how passwords are handled and stored. You can choose to store passwords securely on the device or within the application, or opt out to manually enter them each time. All stored passwords are encrypted.",
			checked: false,
		},
	]);
	useEffect(() => {
		proxyFetchGet("/api/user/privacy")
			.then((res) => {
				let hasFalse = false;
				setSettings((prev) =>
					prev.map((item, index) => {
						if (!res[API_FIELDS[index]]) {
							hasFalse = true;
						}
						return {
							...item,
							checked: res[API_FIELDS[index]] || false,
						};
					})
				);
				setPrivacy(!hasFalse);
			})
			.catch((err) => console.error("Failed to fetch settings:", err));
	}, []);

	const handleTurnOnAll = (type: boolean) => {
		const newSettings = settings.map((item) => ({
			...item,
			checked: type,
		}));
		setSettings(newSettings);
		setPrivacy(type);
		const requestData = {
			[API_FIELDS[0]]: type,
			[API_FIELDS[1]]: type,
			[API_FIELDS[2]]: type,
			[API_FIELDS[3]]: type,
		};

		proxyFetchPut("/api/user/privacy", requestData);
	};

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

	const [logFolder, setLogFolder] = useState("");
	useEffect(() => {
		window.ipcRenderer.invoke("get-log-folder", email).then((logFolder) => {
			setLogFolder(logFolder);
		});
	}, [email]);

	const handleOpenFolder = () => {
		if (logFolder) {
			window.ipcRenderer.invoke("reveal-in-folder", logFolder + "/");
		}
	};

	return (
		<div className="pr-2">
			<h2 className="mb-2">Data Privacy</h2>
			<p className="mt-2 text-sm">
				Eigent is built on a local-first principle to ensure your privacy. Your
				data remains on your device by default. Cloud features are optional and
				only use the minimum data necessary to function. For full details, visit
				our{" "}
				<a
					className="text-blue-500 no-underline"
					href="https://www.eigent.ai/privacy-policy"
					target="_blank"
				>
					Privacy Policy
				</a>
				.
			</p>
			<h3 className="mb-0 text-sm">How we handle your data</h3>
			<ol className="pl-5 mt-2 text-sm">
				<li>We only use the essential data needed to run your tasks:</li>
				<ul className="pl-4 mb-2">
					<li>
						Eigent may capture screenshots to analyze UI elements, read text,
						and determine the next action, just as you would.
					</li>
					<li>
						Eigent may use your mouse and keyboard to access local software and
						files you specify.
					</li>
					<li>
						Only the minimum task data is sent to AI model providers or the
						third-party integrations you enable; we have zero data-retention
						agreements with these providers.
					</li>
				</ul>
				<li>
					Task files, outputs and screenshots remain in your designated task
					folder locally.
				</li>
				<li>
					Credentials are stored locally, encrypted, and used only for approved
					steps.
				</li>
				<li>
					Your data is never used to train our AI models without your explicit
					consent.
				</li>
				<li>We don’t sell your data to third parties.</li>
			</ol>

			{/* Privacy controls */}
			<h2 className="mb-2">Privacy controls</h2>
			<div className="flex gap-2 h-[32px]">
				<div className="font-bold leading-4">Task Directory</div>
				<div className="flex-1 text-sm text-text-secondary bg-white-100% text-gray-400 h-[32px] flex items-center px-2 cursor-pointer">
					<div className="text-ellipsis overflow-hidden">{logFolder || ""}</div>
					<div className="ml-auto flex items-center">
						<FolderSearch className="w-4 h-4 ml-2" />
					</div>
				</div>
				<Button onClick={handleOpenFolder} size="sm" disabled={!logFolder}>
					Open Folder
				</Button>
			</div>
			<div className="px-6 py-4 bg-surface-secondary rounded-2xl mt-4">
				<div className="flex gap-md">
					<div>
						<div className="text-base font-bold leading-12 text-text-primary">
							Enable Privacy Permissions Settings
						</div>
						<div className="text-sm leading-13">
							By turning this on, you acknowledge that you have read and agree
							to our Privacy Policy regarding how your task data is collected,
							processed, and protected.
						</div>
					</div>
					<div>
						<Switch
							checked={_privacy}
							onCheckedChange={() => handleTurnOnAll(!_privacy)}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
