import { useAuthStore } from "@/store/authStore";
import { useNavigate, useLocation } from "react-router-dom";
import { useCallback, useEffect, useState } from "react";
import { useStackApp } from "@stackframe/react";
import loginGif from "@/assets/login.gif";
import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import github2 from "@/assets/github2.svg";
import google from "@/assets/google.svg";
import eye from "@/assets/eye.svg";
import eyeOff from "@/assets/eye-off.svg";
import { proxyFetchPost } from "@/api/http";
import { hasStackKeys } from "@/lib";

const HAS_STACK_KEYS = hasStackKeys();
let lock = false;
export default function SignUp() {
	const app = HAS_STACK_KEYS ? useStackApp() : null;
	const { setAuth, initState } = useAuthStore();
	const navigate = useNavigate();
	const location = useLocation();
	const [hidePassword, setHidePassword] = useState(true);

	const [formData, setFormData] = useState({
		email: "",
		password: "",
		invite_code: "",
	});
	const [errors, setErrors] = useState({
		email: "",
		password: "",
		invite_code: "",
	});
	const [isLoading, setIsLoading] = useState(false);
	const [generalError, setGeneralError] = useState("");

	const validateEmail = (email: string) => {
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		return emailRegex.test(email);
	};

	const validateForm = () => {
		const newErrors = {
			email: "",
			password: "",
			invite_code: "",
		};

		if (!formData.email) {
			newErrors.email = "Please enter email address";
		} else if (!validateEmail(formData.email)) {
			newErrors.email = "Please enter a valid email address";
		}

		if (!formData.password) {
			newErrors.password = "Please enter password";
		} else if (formData.password.length < 8) {
			newErrors.password = "Password must be at least 8 characters";
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

	const handleRegister = async () => {
		if (!validateForm()) {
			return;
		}

		setGeneralError("");
		setIsLoading(true);
		try {
			const data = await proxyFetchPost("/api/register", {
				email: formData.email,
				password: formData.password,
				invite_code: formData.invite_code,
			});

			if (data.code === 10 || data.code === 1) {
				setGeneralError(data.text || "Sign up failed, please try again");
				return;
			}
			if (data.code === 100 && data.error) {
				let errors = {
					email: "",
					password: "",
					invite_code: "",
				};
				data.error.map((item: any) => {
					errors[item.loc.at(-1) as keyof typeof errors] = item.msg.replace(
						"Value error,",
						""
					);
				});
				setErrors(errors);
				return;
			}

			// setAuth({ email: formData.email, ...data });
			navigate("/login");
		} catch (error: any) {
			console.error("Sign up failed:", error);
			setGeneralError("Sign up failed, please check your email and password");
		} finally {
			setIsLoading(false);
		}
	};

	const handleLoginByStack = async (token: string) => {
		try {
			const data = await proxyFetchPost("/api/login-by_stack?token=" + token, {
				token: token,
				invite_code: localStorage.getItem("invite_code") || "",
			});

			if (data.code === 10) {
				setGeneralError(data.text || "Login failed, please try again");
				return;
			}
			console.log("data", data);
			setAuth({ email: formData.email, ...data });
			navigate("/");
		} catch (error: any) {
			console.error("Login failed:", error);
			setGeneralError("Login failed, please check your email and password");
		} finally {
			setIsLoading(false);
		}
	};

	const handleReloadBtn = async (type: string) => {
		localStorage.setItem("invite_code", formData.invite_code);
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
		formData.append("client_id", "7b927864-23c3-4bff-969f-ef90e85f1707");
		formData.append(
			"client_secret",
			"pck_r0g1stv09a2fy2ecnc8tfnzt1rdp2dntemt37pjfc4am0"
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
			if (lock || location.pathname !== "/signup") return;

			lock = true;
			setIsLoading(true);
			const accessToken = await handleGetToken(code);
			await handleLoginByStack(accessToken);
			setTimeout(() => {
				lock = false;
			}, 1500);
		},
		[location.pathname]
	);

	useEffect(() => {
		window.ipcRenderer.on("auth-code-received", handleAuthCode);

		return () => {
			window.ipcRenderer.off("auth-code-received", handleAuthCode);
		};
	}, []);

	return (
		<div className={`p-2 flex items-center justify-center gap-2 h-full`}>
			<div className="flex items-center justify-center h-[calc(800px-16px)] rounded-3xl bg-white-100%">
				<img src={loginGif} className=" rounded-3xl h-full object-cover" />
			</div>
			<div className="h-full flex-1 flex flex-col items-center justify-center">
				<div className="flex-1 flex flex-col items-center justify-center">
					<div className="w-80">
						<div className="h-[46px] relative text-[#27272A] font-inter text-[36px] font-bold leading-[46px]">
							Sign Up
							<span 
								onClick={() => navigate("/login")}
								className="absolute bottom-0 right-0 text-[#27272A] font-inter text-[13px] font-normal leading-5 cursor-pointer"
							>
								Login
							</span>
						</div>
						{HAS_STACK_KEYS && <div className="w-full pt-6">
							<Button
								variant="primary"
								size="lg"
								onClick={() => handleReloadBtn("google")}
								className="w-full rounded-[24px] mb-4 transition-all duration-300 ease-in-out text-[#F5F5F5] text-center font-inter text-[15px] font-bold leading-[22px] justify-center"
								disabled={isLoading}
							>
								<img src={google} className="w-5 h-5" />
								<span className="ml-2">Continue with Google</span>
							</Button>
							<Button
								variant="primary"
								size="lg"
								onClick={() => handleReloadBtn("github")}
								className="w-full rounded-[24px] mb-4 transition-all duration-300 ease-in-out text-[#F5F5F5] text-center font-inter text-[15px] font-bold leading-[22px] justify-center"
								disabled={isLoading}
							>
								<img src={github2} className="w-5 h-5" />
								<span className="ml-2">Continue with Github</span>
							</Button>
							</div>}
						{HAS_STACK_KEYS && <div className="mt-2 w-full text-[#222] text-center font-inter text-[15px] font-medium leading-[22px] mb-6">
							or
						</div>}
						<div className="w-full">
							{generalError && (
								<p className="text-red-500 text-sm mt-0.5 mb-4">{generalError}</p>
							)}
							<div className="w-full mb-4 relative">
								<Label htmlFor="email" className="inline-block text-[#222] font-inter text-[13px] font-bold leading-5 h-5 mb-1.5">
									Email
								</Label>
								<div className="relative">
									<Input
										id="email"
										type="email"
										placeholder="Enter your email"
										required
										value={formData.email}
										onChange={(e) => handleInputChange("email", e.target.value)}
										className={`rounded border border-[#CCC] bg-white shadow-none text-[13px] text-input-text-focus font-normal ${errors.email ? "border-red-500" : ""}`}
									/>
								</div>
								{errors.email && (
									<p className="text-red-500 text-sm mt-0.5">{errors.email}</p>
								)}
							</div>
							<div className="w-full mb-4 relative">
								<div className="flex items-center">
									<Label htmlFor="password" className="inline-block text-[#222] font-inter text-[13px] font-bold leading-5 h-5 mb-1.5">
										Password
									</Label>
								</div>

								<div className="relative">
									<div
										className="cursor-pointer w-6 h-6 absolute top-0 bottom-0 m-auto right-1.5"
										onClick={() => {
											setHidePassword(!hidePassword);
										}}
									>
										<img src={hidePassword ? eye : eyeOff} />
									</div>
									<Input
										id="password"
										type={hidePassword ? "password" : "text"}
										required
										placeholder="Enter your password"
										value={formData.password}
										onChange={(e) =>
											handleInputChange("password", e.target.value)
										}
										className={`rounded border border-[#CCC] bg-white shadow-none text-[13px] text-input-text-focus font-normal pr-9 ${errors.password ? "border-red-500" : ""}`}
									/>
								</div>
								{errors.password && (
									<p className="text-red-500 text-sm mt-0.5">
										{errors.password}
									</p>
								)}
							</div>
							<div className="w-full mb-4 relative">
								<Label htmlFor="invite_code" className="inline-block text-[#222] font-inter text-[13px] font-bold leading-5 h-5 mb-1.5">
									Invitation Code
								</Label>
								<div className="relative">
									<Input
										id="invite_code"
										type="text"
										placeholder="Enter your invite code(optional)"
										required
										value={formData.invite_code}
										onChange={(e) =>
											handleInputChange("invite_code", e.target.value)
										}
										className={`rounded border border-[#CCC] bg-white shadow-none text-[13px] text-input-text-focus font-normal ${errors.invite_code ? "border-red-500" : ""}`}
									/>
								</div>
								{errors.invite_code && (
									<p className="text-red-500 text-sm mt-0.5">
										{errors.invite_code}
									</p>
								)}
							</div>
						</div>
						<Button
							onClick={handleRegister}
							size="lg"
							variant="ghost"
							type="submit"
							className="w-full rounded-[24px] mt-4 bg-white-100% text-[#222] text-center transition-all duration-300 ease-in-out font-inter text-[15px] font-bold leading-[22px] hover:bg-white-80%"
							disabled={isLoading}
						>
							<span className="flex-1">
								{isLoading ? "Signing up..." : "Sign Up"}
							</span>
						</Button>
					</div>
				</div>

				<div className="text-text-body text-xs font-medium leading-tight">
					Privacy Policy
				</div>
			</div>
		</div>
	);
}
