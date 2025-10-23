import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { proxyFetchGet, proxyFetchPost } from "@/api/http";
import { useTranslation } from "react-i18next";

interface ConfigItem {
	name: string;
	env_vars: string[];
}

export default function SettingAPI() {
	const { t } = useTranslation();
	const [items, setItems] = useState<ConfigItem[]>([]);
	const [envValues, setEnvValues] = useState<Record<string, string>>({});
	const [loading, setLoading] = useState<Record<string, boolean>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});

	useEffect(() => {
		proxyFetchGet("/api/config/info").then((res) => {
			const configs = Object.entries(res || {})
				.map(([name, v]: [string, any]) => ({ name, env_vars: v.env_vars }))
				.filter((item) => Array.isArray(item.env_vars) && item.env_vars.length > 0);
			setItems(configs);
		});
		proxyFetchGet("/api/configs").then((res) => {
			if (Array.isArray(res)) {
				const envMap: Record<string, string> = {};
				res.forEach((item: any) => {
					if (item.config_name && item.config_value) {
						envMap[item.config_name] = item.config_value;
					}
				});
				setEnvValues(envMap);
			}
		});
	}, []);

	const handleInputChange = (env: string, value: string) => {
		setEnvValues((prev) => ({ ...prev, [env]: value }));
	};

	const handleVerify = async (configGroup: string, env: string) => {
		const value = envValues[env] || "";
		if (!value.trim()) {
			setErrors((prev) => ({ ...prev, [env]: t("layout.env-should-not-empty") }));
			return;
		} else {
			setErrors((prev) => ({ ...prev, [env]: "" }));
		}
		setLoading((prev) => ({ ...prev, [env]: true }));
		try {
			await proxyFetchPost("/api/configs", {
				config_name: env,
				config_value: value,
				config_group: configGroup,
			});
		} catch (e) {
		} finally {
			setLoading((prev) => ({ ...prev, [env]: false }));
		}
	};

	return (
		<div className="space-y-8">
			{items.map((item) => (
				<div key={item.name} className="px-6 py-4 bg-bg-surface-tertiary rounded-2xl">
					<div>
						<div className="text-base font-bold leading-12 text-text-primary">{item.name}</div>
					</div>
					<div className="mt-md">
						<div>
							{item.env_vars.map((env) => (
								<div key={env} className="mt-md">
									<div className="flex items-center gap-2">
										<Input
											id={env}
											placeholder={env}
											className="w-full"
											value={envValues[env] || ""}
											onChange={(e) => {
												handleInputChange(env, e.target.value);
												if (errors[env]) setErrors((prev) => ({ ...prev, [env]: "" }));
											}}
										/>
										<Button
											className="shadow-none px-sm py-xs bg-bg-fill-disabled"
											onClick={() => handleVerify(item.name, env)}
											disabled={loading[env]}
										>
											<span className="text-sm leading-13 text-text-inverse-primary">
												{loading[env] ? t("layout.loading") : t("layout.verify")}
											</span>
											<Circle className="w-4 h-4 text-icon-inverse-primary" />
										</Button>
									</div>
									<div className="text-xs leading-17 text-text-secondary mt-1.5">{env}</div>
									{errors[env] && (
										<span className="text-xs text-red-500 mt-1">{errors[env]}</span>
									)}
								</div>
							))}
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
