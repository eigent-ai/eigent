import { useAuthStore } from "@/store/authStore";
import { useNavigate, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState, useRef } from "react";
import { useStackApp } from "@stackframe/react";
import loginGif from "@/assets/login.gif";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import github2 from "@/assets/github2.svg";
import google from "@/assets/google.svg";
import eye from "@/assets/eye.svg";
import eyeOff from "@/assets/eye-off.svg";
import { proxyFetchPost } from "@/api/http";
import { hasStackKeys } from "@/lib";
import { useTranslation } from "react-i18next";
import WindowControls from "@/components/WindowControls";

const HAS_STACK_KEYS = hasStackKeys();
let lock = false;
export default function Login() {
	const app = HAS_STACK_KEYS ? useStackApp() : null;
	const { setAuth, setModelType, setLocalProxyValue } = useAuthStore();
	const navigate = useNavigate();
	const location = useLocation();
	const [hidePassword, setHidePassword] = useState(true);
	const { t } = useTranslation();
	const [formData, setFormData] = useState({
		email: "",
		password: "",
	});
	const [errors, setErrors] = useState({
		email: "",
		password: "",
	});
	const [isLoading, setIsLoading] = useState(false);
	const [generalError, setGeneralError] = useState("");
	const titlebarRef = useRef<HTMLDivElement>(null);
	const [platform, setPlatform] = useState<string>("");

	const validateEmail = (email: string) => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	};

	const validateForm = () => {
		const newErrors = {
			email: "",
			password: "",
		};

		if (!formData.email) {
			newErrors.email = t("layout.please-enter-email-address");
		} else if (!validateEmail(formData.email)) {
			newErrors.email = t("layout.please-enter-a-valid-email-address");
		}

		if (!formData.password) {
			newErrors.password = t("layout.please-enter-password");
		} else if (formData.password.length < 6) {
			newErrors.password = t("layout.password-must-be-at-least-8-characters");
		}

		setErrors(newErrors);
		return !newErrors.email && !newErrors.password;
	};

	const handleInputChange = (field: string, value: string) => {
		setFormData((prev) => ({
			...prev,
			[field]: value,
		}));

		if (errors[field as keyof typeof errors]) {
			setErrors((prev) => ({
				...prev,
				[field]: "",
			}));
		}

		if (generalError) {
			setGeneralError("");
		}
	};

	//
	const handleLogin = async () => {
		if (!validateForm()) {
			return;
		}

		setGeneralError("");
		setIsLoading(true);
		try {
			const data = await proxyFetchPost("/api/login", {
				email: formData.email,
				password: formData.password,
			});

			if (data.code === 10) {
				setGeneralError(data.text || t("layout.login-failed-please-try-again"));
				return;
			}

			setAuth({ email: formData.email, ...data });
			setModelType('cloud');
			// Record VITE_USE_LOCAL_PROXY value at login
			const localProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
			setLocalProxyValue(localProxyValue);
			navigate("/");
		} catch (error: any) {
			console.error("Login failed:", error);
			setGeneralError(t("layout.login-failed-please-check-your-email-and-password"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleLoginByStack = async (token: string) => {
		try {
			const data = await proxyFetchPost("/api/login-by_stack?token=" + token, {
				token: token,
			});

			if (data.code === 10) {
				setGeneralError(data.text || t("layout.login-failed-please-try-again"));
				return;
			}
			console.log("data", data);
			setModelType('cloud');
			setAuth({ email: formData.email, ...data });
			// Record VITE_USE_LOCAL_PROXY value at login
			const localProxyValue = import.meta.env.VITE_USE_LOCAL_PROXY || null;
			setLocalProxyValue(localProxyValue);
			navigate("/");
		} catch (error: any) {
			console.error("Login failed:", error);
			setGeneralError(t("layout.login-failed-please-check-your-email-and-password"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleReloadBtn = async (type: string) => {
		console.log("handleReloadBtn1", type);
		const cookies = document.cookie.split("; ");
		cookies.forEach((cookie) => {
			const [name] = cookie.split("=");
			if (name.startsWith("stack-oauth-outer-")) {
				document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
			}
		});
		console.log("handleReloadBtn2", type);
		await app.signInWithOAuth(type);
	};

	const handleGetToken = async (code: string) => {
		const code_verifier = localStorage.getItem("stack-oauth-outer-");
		const formData = new URLSearchParams();
		console.log(
			"import.meta.env.PROD",
			import.meta.env.PROD
				? `${import.meta.env.VITE_BASE_URL}/api/redirect/callback`
				: `${import.meta.env.VITE_PROXY_URL}/api/redirect/callback`
		);
		formData.append(
			"redirect_uri",
			import.meta.env.PROD
				? `${import.meta.env.VITE_BASE_URL}/api/redirect/callback`
				: `${import.meta.env.VITE_PROXY_URL}/api/redirect/callback`
		);
		formData.append("code_verifier", code_verifier || "");
		formData.append("code", code);
		formData.append("grant_type", "authorization_code");
		formData.append("client_id", "aa49cdd0-318e-46bd-a540-0f1e5f2b391f");
		formData.append(
			"client_secret",
			"pck_t13egrd9ve57tz52kfcd2s4h1zwya5502z43kr5xv5cx8"
		);

		try {
			const res = await fetch(
				"https://api.stack-auth.com/api/v1/auth/oauth/token",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
					},
					body: formData,
				}
			);
			const data = await res.json(); // parse response data
			return data.access_token;
		} catch (error) {
			console.error(error);
			setIsLoading(false);
		}
	};

	const handleAuthCode = useCallback(
		async (event: any, code: string) => {
			if (lock || location.pathname !== "/login") return;

			lock = true;
			setIsLoading(true);
			let accessToken = await handleGetToken(code);
			handleLoginByStack(accessToken);
			setTimeout(() => {
				lock = false;
			}, 1500);
		},
		[location.pathname]
	);

	useEffect(() => {
		window.ipcRenderer?.on("auth-code-received", handleAuthCode);

		return () => {
			window.ipcRenderer?.off("auth-code-received", handleAuthCode);
		};
	}, []);

	useEffect(() => {
		const p = window.electronAPI.getPlatform();
		setPlatform(p);

		if (platform === "darwin") {
			titlebarRef.current?.classList.add("mac");
		}
	}, [platform]);

	// Handle before-close event for login page
	useEffect(() => {
		const handleBeforeClose = () => {
			// On login page, always close directly without confirmation
			window.electronAPI.closeWindow(true);
		};

		window.ipcRenderer?.on("before-close", handleBeforeClose);

		return () => {
			window.ipcRenderer?.off("before-close", handleBeforeClose);
		};
	}, []);

	return (
		<div className="h-full flex flex-col relative overflow-hidden">
			{/* Titlebar with drag region and window controls */}
			<div
				className="absolute top-0 left-0 right-0 flex !h-9 items-center justify-between pl-2 py-1 z-50"
				id="login-titlebar"
				ref={titlebarRef}
				style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
			>
				{/* Left spacer for macOS */}
				<div
					className={`${
						platform === "darwin" ? "w-[70px]" : "w-0"
					} flex items-center justify-center`}
					style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
				>
					{platform === "darwin" && <span className="text-label-md text-text-heading font-bold">Eigent</span>}
				</div>

				{/* Center drag region */}
				<div 
					className="h-full flex-1 flex items-center"
					style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
				>
					<div className="flex-1 h-10"></div>
				</div>

				{/* Right window controls */}
				<div 
					style={{ WebkitAppRegion: 'no-drag', pointerEvents: 'auto' } as React.CSSProperties}
					onMouseDown={(e) => e.stopPropagation()}
					onClick={(e) => e.stopPropagation()}
				>
					<WindowControls />
				</div>
			</div>

			{/* Main content - image extends to top, form has padding */}
			<div className={`p-2 flex items-center justify-center gap-2 h-full`}>
				<div className="flex items-center justify-center h-full rounded-3xl bg-white-100%">
					<img src={loginGif} className="rounded-3xl h-full object-cover" />
				</div>
				<div className="h-full flex-1 flex flex-col items-center justify-center pt-11">
				<div className="flex-1 flex flex-col w-80 items-center justify-center">
						<div className="flex self-stretch items-end justify-between mb-4">
							  <div className="text-text-heading text-heading-lg font-bold ">
								  {t("layout.login")}
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => navigate("/signup")}
								>
									{t("layout.sign-up")}
								</Button>
						</div>
						{HAS_STACK_KEYS && (
							<div className="w-full pt-6">
								<Button
									variant="primary"
									size="lg"
									onClick={() => handleReloadBtn("google")}
									className="w-full rounded-[24px] mb-4 transition-all duration-300 ease-in-out text-[#F5F5F5] text-center font-inter text-[15px] font-bold leading-[22px] justify-center"
									disabled={isLoading}
								>
									<img src={google} className="w-5 h-5" />
									<span className="ml-2">{t("layout.continue-with-google-login")}</span>
								</Button>
								<Button
									variant="primary"
									size="lg"
									onClick={() => handleReloadBtn("github")}
									className="w-full rounded-[24px] mb-4 transition-all duration-300 ease-in-out text-[#F5F5F5] text-center font-inter text-[15px] font-bold leading-[22px] justify-center"
									disabled={isLoading}
								>
									<img src={github2} className="w-5 h-5" />
									<span className="ml-2">{t("layout.continue-with-github-login")}</span>
								</Button>
							</div>
						)}
						{HAS_STACK_KEYS && (
							<div className="mt-2 w-full text-[#222] text-center font-inter text-[15px]  font-medium leading-[22px] mb-6">
								{t("layout.or")}
							</div>
						)}
						<div className="flex flex-col gap-4 w-full">
							{generalError && (
								<p className="text-text-cuation text-label-md mt-1 mb-4">
									{generalError}
								</p>
							)}
							<div className="flex flex-col gap-4 w-full mb-4 relative">
									<Input
										id="email"
										type="email"
										size="default"
										title={t("layout.email")}
										placeholder={t("layout.enter-your-email")}
										required
										value={formData.email}
										onChange={(e) => handleInputChange("email", e.target.value)}
										state={errors.email ? "error" : undefined}
										note={errors.email}
									onEnter={handleLogin}
									/>

									<Input
										id="password"
										title={t("layout.password")}
										size="default"
										type={hidePassword ? "password" : "text"}
										required
										placeholder={t("layout.enter-your-password")}
										value={formData.password}
										onChange={(e) =>
											handleInputChange("password", e.target.value)
										}
										state={errors.password ? "error" : undefined}
										note={errors.password}
										backIcon={<img src={hidePassword ? eye : eyeOff} />}
										onBackIconClick={() => setHidePassword(!hidePassword)}
									onEnter={handleLogin}
									/>
							</div>
						</div>
						<Button
							onClick={handleLogin}
							size="md"
							variant="primary"
							type="submit"
							className="w-full rounded-full"
							disabled={isLoading}
						>
							<span className="flex-1">
								{isLoading ? t("layout.logging-in") : t("layout.log-in")}
							</span>
						</Button>
				</div>
				<Button 
				  variant="ghost"
					size="xs"
					onClick={() => window.open("https://www.eigent.ai/privacy-policy", "_blank", "noopener,noreferrer")}
				>
					{t("layout.privacy-policy")}
				</Button>
				</div>
			</div>
		</div>
	);
}
