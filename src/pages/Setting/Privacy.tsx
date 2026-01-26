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

import { Switch } from "@/components/ui/switch";
import { useState, useEffect } from "react";
import { proxyFetchGet, proxyFetchPut } from "@/api/http";
import { Button } from "@/components/ui/button";
import { FolderSearch, ChevronDown } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useTranslation } from "react-i18next";
export default function SettingPrivacy() {
	const { email } = useAuthStore();
	const [_privacy, setPrivacy] = useState(false);
	const { t } = useTranslation();
	const API_FIELDS = [
		"take_screenshot",
		"access_local_software",
		"access_your_address",
		"password_storage",
	];
	const [settings, setSettings] = useState([
		{
			title: t("setting.allow-agent-to-take-screenshots"),
			description: t("setting.allow-agent-to-take-screenshots-description"),
			checked: false,
		},
		{
			title: t("setting.allow-agent-to-access-local-software"),
			description: t("setting.allow-agent-to-access-local-software-description"),
			checked: false,
		},
		{
			title: t("setting.allow-agent-to-access-your-address"),
			description: t("setting.allow-agent-to-access-your-address-description"),
			checked: false,
		},
		{
			title: t("setting.password-storage"),
			description: t("setting.password-storage-description"),
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
	const [isHowWeHandleOpen, setIsHowWeHandleOpen] = useState(false);
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
		<div className="flex-1 w-full h-auto m-auto">
			{/* Header Section */}
			<div className="flex px-6 pt-8 pb-6 max-w-[900px] mx-auto w-full items-center justify-between">
				<div className="flex flex-row items-center justify-between w-full gap-4">
					<div className="flex flex-col">
						<div className="text-heading-sm font-bold text-text-heading">{t("setting.privacy")}</div>
					</div>
				</div>
			</div>

			{/* Content Section */}
			<div className="flex flex-col gap-6">
				{/* How We Handle Your Data Section */}
				<div className="px-6 py-4 bg-surface-secondary rounded-2xl">
					<div className="flex items-start justify-between gap-4">
						<div className="flex flex-col gap-2 flex-1">
							<div className="text-body-base font-bold text-text-heading">{t("setting.how-we-handle-your-data")}</div>
							<span className="text-body-sm font-normal text-text-body">
								{t("setting.data-privacy-description")}
								{" "}
								<a
									className="text-blue-500 no-underline"
									href="https://www.eigent.ai/privacy-policy"
									target="_blank"
								>
									{t("setting.privacy-policy")}
								</a>
								.
							</span>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setIsHowWeHandleOpen((prev) => !prev)}
							aria-expanded={isHowWeHandleOpen}
							aria-controls="how-we-handle-your-data"
						>
							<ChevronDown
								className={`w-4 h-4 transition-transform ${isHowWeHandleOpen ? "rotate-0" : "-rotate-90"}`}
							/>
						</Button>
					</div>
					{isHowWeHandleOpen && (
						<div className="mt-4 mr-10 border-b-0 border-x-0 border-t-[0.5px] border-solid border-border-secondary">
							<ol id="how-we-handle-your-data" className="pl-5 text-body-sm text-text-body font-normal">
								<li>{t("setting.we-only-use-the-essential-data-needed-to-run-your-tasks")}:</li>
								<ul className="pl-4 mb-2">
									<li>
										{t("setting.how-we-handle-your-data-line-1-line-1")}
									</li>
									<li>
										{t("setting.how-we-handle-your-data-line-1-line-2")}
									</li>
									<li>
										{t("setting.how-we-handle-your-data-line-1-line-3")}
									</li>
								</ul>
								<li>
									{t("setting.how-we-handle-your-data-line-2")}
								</li>
								<li>
									{t("setting.how-we-handle-your-data-line-3")}
								</li>
								<li>
									{t("setting.how-we-handle-your-data-line-4")}
								</li>
								<li>{t("setting.how-we-handle-your-data-line-5")}</li>
							</ol>
						</div>
					)}
				</div>

				{/* Enable Privacy Permissions Settings Section */}
				<div className="px-6 py-4 bg-surface-secondary rounded-2xl">
					<div className="flex gap-md items-center justify-between">
						<div className="flex flex-col gap-2">
							<div className="text-body-base font-bold text-text-heading">
								{t("setting.enable-privacy-permissions-settings")}
							</div>
							<div className="text-body-sm text-text-body font-normal">
								{t("setting.enable-privacy-permissions-settings-description")}
							</div>
						</div>
						<div className="flex items-center justify-center">
							<Switch
								checked={_privacy}
								onCheckedChange={() => handleTurnOnAll(!_privacy)}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
