import { getAuthStore } from "@/store/authStore";
import { showCreditsToast } from "@/components/Toast/creditsToast";
import { showStorageToast } from "@/components/Toast/storageToast";
import { showTrafficToast } from "@/components/Toast/trafficToast";
const defaultHeaders = {
	"Content-Type": "application/json",
};

let baseUrl = "";
export async function getBaseURL() {
	if (baseUrl) {
		return baseUrl;
	}
	const port = await window.ipcRenderer.invoke("get-backend-port");
	baseUrl = `http://localhost:${port}`;
	return baseUrl;
}

async function fetchRequest(
	method: "GET" | "POST" | "PUT" | "DELETE",
	url: string,
	data?: Record<string, any>,
	customHeaders: Record<string, string> = {},
): Promise<any> {
	const baseURL = await getBaseURL();
	const fullUrl = `${baseURL}${url}`;
	const { token } = getAuthStore();

	const headers: Record<string, string> = {
		...defaultHeaders,
		...customHeaders,
	};

	// Cases without token: url is a complete http:// path
	if (!url.includes("http://") && token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	const options: RequestInit = {
		method,
		headers,
	};

	if (method === "GET") {
		const query = data
			? "?" +
				Object.entries(data)
					.map(
						([key, val]) =>
							`${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
					)
					.join("&")
			: "";
		return handleResponse(fetch(fullUrl + query, options), data);
	}

	if (data) {
		options.body = JSON.stringify(data);
	}

	return handleResponse(fetch(fullUrl, options), data);
}

async function handleResponse(
	responsePromise: Promise<Response>,
	requestData?: Record<string, any>,
): Promise<any> {
	try {
		const res = await responsePromise;
		if (res.status === 204) {
			return { code: 0, text: "" };
		}

		const contentType = res.headers.get("content-type") || "";
		if (res.body && !contentType.includes("application/json")) {
			return {
				isStream: true,
				body: res.body,
				reader: res.body.getReader(),
			};
		}
		const resData = await res.json();
		if (!resData) {
			return null;
		}
		const { code, text } = resData;
		// showCreditsToast()
		if (code === 1 || code === 300) {
			return resData;
		}

		if (code === 20) {
			showCreditsToast();
			return resData;
		}

		if (code === 21) {
			showStorageToast();
			return resData;
		}

		if (code === 13) {
			// const { logout } = getAuthStore()
			// logout()
			// window.location.href = '#/login'
			throw new Error(text);
		}

		return resData;
	} catch (err: any) {
		// Only show traffic toast for cloud model requests
		const isCloudRequest = requestData?.api_url === "cloud";
		if (isCloudRequest) {
			showTrafficToast();
		}

		console.error("[fetch error]:", err);

		if (err?.response?.status === 401) {
			// const { logout } = getAuthStore()
			// logout()
			// window.location.href = '#/login'
		}

		throw err;
	}
}

// Encapsulate common methods
export const fetchGet = (url: string, params?: any, headers?: any) =>
	fetchRequest("GET", url, params, headers);

export const fetchPost = (url: string, data?: any, headers?: any) =>
	fetchRequest("POST", url, data, headers);

export const fetchPut = (url: string, data?: any, headers?: any) =>
	fetchRequest("PUT", url, data, headers);

export const fetchDelete = (url: string, data?: any, headers?: any) =>
	fetchRequest("DELETE", url, data, headers);

// =============== porxy ===============

// get proxy base URL
async function getProxyBaseURL() {
	const isDev = import.meta.env.DEV;

	if (isDev) {
		const proxyUrl = import.meta.env.VITE_PROXY_URL;
		if (!proxyUrl) {
			return "http://localhost:3001";
		}
		return proxyUrl;
	} else {
		const baseUrl = import.meta.env.VITE_BASE_URL;
		if (!baseUrl) {
			throw new Error("VITE_BASE_URL not configured");
		}
		return baseUrl;
	}
}

async function proxyFetchRequest(
	method: "GET" | "POST" | "PUT" | "DELETE",
	url: string,
	data?: Record<string, any>,
	customHeaders: Record<string, string> = {},
): Promise<any> {
	const baseURL = await getProxyBaseURL();
	const fullUrl = `${baseURL}${url}`;
	const { token } = getAuthStore();

	const headers: Record<string, string> = {
		...defaultHeaders,
		...customHeaders,
	};

	console.debug("url", url, token);
	if (!url.includes("http://") && !url.includes("https://") && token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	if (import.meta.env.DEV) {
		const targetUrl = import.meta.env.VITE_BASE_URL;
		if (targetUrl) {
			headers["X-Proxy-Target"] = targetUrl;
		}
	}

	const options: RequestInit = {
		method,
		headers,
	};

	if (method === "GET") {
		const query = data
			? "?" +
				Object.entries(data)
					.map(
						([key, val]) =>
							`${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
					)
					.join("&")
			: "";
		return handleResponse(fetch(fullUrl + query, options));
	}

	if (data) {
		options.body = JSON.stringify(data);
	}

	return handleResponse(fetch(fullUrl, options));
}

export const proxyFetchGet = (url: string, params?: any, headers?: any) =>
	proxyFetchRequest("GET", url, params, headers);

export const proxyFetchPost = (url: string, data?: any, headers?: any) =>
	proxyFetchRequest("POST", url, data, headers);

export const proxyFetchPut = (url: string, data?: any, headers?: any) =>
	proxyFetchRequest("PUT", url, data, headers);

export const proxyFetchDelete = (url: string, data?: any, headers?: any) =>
	proxyFetchRequest("DELETE", url, data, headers);

// File upload function with FormData
export async function uploadFile(
	url: string,
	formData: FormData,
	headers?: Record<string, string>,
): Promise<any> {
	const baseURL = await getProxyBaseURL();
	const fullUrl = `${baseURL}${url}`;
	const { token } = getAuthStore();

	const requestHeaders: Record<string, string> = {
		...headers,
	};

	// Remove Content-Type header to let browser set it with boundary for FormData
	if (requestHeaders["Content-Type"]) {
		delete requestHeaders["Content-Type"];
	}

	if (!url.includes("http://") && !url.includes("https://") && token) {
		requestHeaders["Authorization"] = `Bearer ${token}`;
	}

	if (import.meta.env.DEV) {
		const targetUrl = import.meta.env.VITE_BASE_URL;
		if (targetUrl) {
			requestHeaders["X-Proxy-Target"] = targetUrl;
		}
	}

	const options: RequestInit = {
		method: "POST",
		headers: requestHeaders,
		body: formData,
	};

	return handleResponse(fetch(fullUrl, options));
}
