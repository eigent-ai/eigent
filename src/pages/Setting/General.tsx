import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogOut, Settings, Check } from "lucide-react";
import light from "@/assets/light.png";
import dark from "@/assets/dark.png";
import transparent from "@/assets/transparent.png";
import { useAuthStore } from "@/store/authStore";
import { useNavigate } from "react-router-dom";
import { proxyFetchPut, proxyFetchGet } from "@/api/http";
import { createRef, RefObject } from "react";
import { useEffect, useState } from "react";
import { LocaleEnum, switchLanguage } from "@/i18n";
import { useTranslation } from "react-i18next";

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
		<div className="flex flex-col gap-4 pb-40">
			<div className="px-6 py-4 flex flex-col w-fullitems-center justify-between gap-2 bg-surface-secondary rounded-2xl">
			<div className="text-body-lg font-bold text-text-heading">
					{t("setting.account")}
				</div>
				<div className="flex flex-row items-center justify-between gap-2">
				<div className="text-body-sm text-text-body font-normal">
					{t("setting.you-are-currently-signed-in-with", {
						email: authStore.email,
					})}
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
							authStore.logout();
							navigate("/login");
						}}
					>
						<LogOut className="w-4 h-4 text-button-tertiery-text-default" />
						{t("setting.log-out")}
					</Button>
				</div>
				</div>
			</div>
			<div className="px-6 py-4 bg-surface-secondary rounded-2xl">
				<div className="text-body-lg font-bold text-text-heading">
					{t("setting.language")}
				</div>
				<div className="mt-md">
					<Select value={language} onValueChange={switchLanguage}>
						<SelectTrigger>
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
			</div>
			<div className="px-6 py-4 bg-surface-secondary rounded-2xl">
				<div className="text-body-lg font-bold text-text-heading">
					{t("setting.appearance")}
				</div>
				<div className="flex items-center gap-md mt-md">
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
								className={`text-sm leading-13 text-text-primary group-hover:underline ${
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
	);
}