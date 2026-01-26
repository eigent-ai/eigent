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

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, Settings, Check } from "lucide-react";
import light from "@/assets/light.png";
import dark from "@/assets/dark.png";
import transparent from "@/assets/transparent.png";
import { useAuthStore } from "@/store/authStore";
import { useInstallationStore } from "@/store/installationStore";
import { useNavigate } from "react-router-dom";
import { proxyFetchPut, proxyFetchGet } from "@/api/http";
import { createRef, RefObject } from "react";
import { useEffect, useState } from "react";
import { useChatStore } from "@/store/chatStore";
import { LocaleEnum, switchLanguage } from "@/i18n";
import { useTranslation, Trans } from "react-i18next";
import { toast } from "sonner";

import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import useChatStoreAdapter from "@/hooks/useChatStoreAdapter";

export default function SettingGeneral() {
	const { t } = useTranslation();
	const authStore = useAuthStore();

	const resetInstallation = useInstallationStore(state => state.reset);
	const setNeedsBackendRestart = useInstallationStore(state => state.setNeedsBackendRestart);

	const navigate = useNavigate();
	const [isLoading, setIsLoading] = useState(false);
	const setAppearance = authStore.setAppearance;
	const language = authStore.language;
	const setLanguage = authStore.setLanguage;
	const appearance = authStore.appearance;
	const fullNameRef: RefObject<HTMLInputElement> = createRef();
	const nickNameRef: RefObject<HTMLInputElement> = createRef();
	const workDescRef: RefObject<HTMLInputElement> = createRef();
	//Get Chatstore for the active project's task
	const { chatStore } = useChatStoreAdapter();
	if (!chatStore) {
		return <div>Loading...</div>;
	}
	

	const [themeList, setThemeList] = useState<any>([
		{
			img: light,
			label: "setting.light",
			value: "light",
		},
		{
			img: transparent,
			label: "setting.transparent",
			value: "transparent",
		},
	]);

	const languageList = [
		{
			key: LocaleEnum.English,
			label: "English",
		},
		{
			key: LocaleEnum.SimplifiedChinese,
			label: "简体中文",
		},
		{
			key: LocaleEnum.TraditionalChinese,
			label: "繁體中文",
		},
		{
			key: LocaleEnum.Japanese,
			label: "日本語",
		},
		{
			key: LocaleEnum.Arabic,
			label: "العربية",
		},
		{
			key: LocaleEnum.French,
			label: "Français",
		},
		{
			key: LocaleEnum.German,
			label: "Deutsch",
		},
		{
			key: LocaleEnum.Russian,
			label: "Русский",
		},
		{
			key: LocaleEnum.Spanish,
			label: "Español",
		},
		{
			key: LocaleEnum.Korean,
			label: "한국어",
		},
		{
			key: LocaleEnum.Italian,
			label: "Italiano",
		},
	];

	useEffect(() => {
		const platform = window.electronAPI.getPlatform();
		console.log(platform);
		if (platform === "darwin") {
			setThemeList([
				{
					img: light,
					label: "setting.light",
					value: "light",
				},
				{
					img: transparent,
					label: "setting.transparent",
					value: "transparent",
				},
			]);
		} else {
			setThemeList([
				{
					img: light,
					label: "setting.light",
					value: "light",
				},
			]);
		}
	}, []);

	return (
		<div className="flex-1 w-full h-auto m-auto">
      {/* Header Section */}
			<div className="flex px-6 pt-8 pb-6 max-w-[900px] mx-auto w-full items-center justify-between">
					<div className="flex flex-row items-center justify-between w-full gap-4">
						<div className="flex flex-col">
							<div className="text-heading-sm font-bold text-text-heading">{t("setting.general")}</div>
						</div>
					</div>
			</div>
      
			{/* Content Section */}
			<div className="flex flex-col gap-6">
				{/* Profile Section */}
				<div className="flex flex-row item-center justify-between px-6 py-4 bg-surface-secondary rounded-2xl">
					<div className="flex flex-col gap-2">
						<div className="text-body-base font-bold text-text-heading">
							{t("setting.profile")}
						</div>
						<div className="text-body-sm">
							<Trans
								i18nKey="setting.you-are-currently-signed-in-with"
								values={{ email: authStore.email }}
								components={{
									email: <span className="text-text-information underline" />,
								}}
							/>
						</div>
					</div>
					<div className="flex items-center gap-sm">
						<Button
							onClick={() => {
								window.location.href = `https://www.eigent.ai/dashboard?email=${authStore.email}`;
							}}
							variant="primary"
							size="xs"
						>
							<Settings className="w-4 h-4 text-button-primary-icon-default" />
							{t("setting.manage")}
						</Button>
						<Button
							variant="outline"
							size="xs"
							onClick={() => {
								chatStore.clearTasks();

								resetInstallation(); // Reset installation state for new account
								setNeedsBackendRestart(true); // Mark that backend is restarting

								authStore.logout();
								navigate("/login");
							}}
						>
							<LogOut className="w-4 h-4 text-button-tertiery-text-default" />
							{t("setting.log-out")}
						</Button>
					</div>
				</div>

				{/* Language Section */}
				<div className="flex flex-row item-center justify-between px-6 py-4 bg-surface-secondary rounded-2xl">
					<div className="flex flex-1 items-center">
					  <div className="text-body-base font-bold text-text-heading">
							{t("setting.language")}
						</div>
					</div>

					<Select value={language} onValueChange={switchLanguage}>
						<SelectTrigger className="w-48">
							<SelectValue placeholder={t("setting.select-language")} />
						</SelectTrigger>
						<SelectContent className="bg-input-bg-default border">
							<SelectGroup>
								<SelectItem value="system">
									{t("setting.system-default")}
								</SelectItem>
								{languageList.map((item) => (
									<SelectItem key={item.key} value={item.key}>
										{item.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>

				{/* Appearance Section */}
				<div className="flex flex-row item-center justify-between px-6 py-4 bg-surface-secondary rounded-2xl">
					<div className="text-body-base font-bold text-text-heading">
						{t("setting.appearance")}
					</div>
					<div className="flex items-center gap-md">
						{themeList.map((item: any) => (
							<div
								key={item.label}
								className="hover:cursor-pointer group flex flex-col items-center gap-sm "
								onClick={() => setAppearance(item.value)}
							>
								<img
									src={item.img}
									className={`rounded-lg transition-all h-[91.67px] aspect-[183/91.67] border border-solid border-transparent group-hover:border-bg-fill-info-primary ${
										item.value == appearance ? "border-bg-fill-info-primary" : ""
									}`}
									alt=""
								/>
								<div
									className={`text-sm text-text-primary group-hover:underline ${
										item.value == appearance ? "underline" : ""
									}`}
								>
									{t(item.label)}
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}