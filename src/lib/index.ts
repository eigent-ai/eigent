export function getProxyBaseURL() {
	const isDev = import.meta.env.DEV

	if (isDev) {
		const proxyUrl = import.meta.env.VITE_PROXY_URL
		if (!proxyUrl) {
			return 'http://localhost:3001'
		}
		return proxyUrl
	} else {
		const baseUrl = import.meta.env.VITE_BASE_URL
		if (!baseUrl) {
			throw new Error("VITE_BASE_URL is not configured");
		}
		return baseUrl;
	}
}

export function generateUniqueId(): string {
	const timestamp = Date.now();
	const random = Math.floor(Math.random() * 10000);
	return `${timestamp}-${random}`;
}

export function debounce<T extends (...args: any[]) => void>(
	func: T,
	wait: number,
	immediate: boolean = false
): (...args: Parameters<T>) => void {
	let timeout: NodeJS.Timeout | null = null;

	return function (this: any, ...args: Parameters<T>) {
		const context = this;

		const later = () => {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};

		const callNow = immediate && !timeout;

		if (timeout) clearTimeout(timeout);
		timeout = setTimeout(later, wait);

		if (callNow) func.apply(context, args);
	};
}


export function capitalizeFirstLetter(input: string): string {
	if (input.length === 0) return input;
	return input.charAt(0).toUpperCase() + input.slice(1);
}

export function hasStackKeys() {
	return import.meta.env.VITE_STACK_PROJECT_ID &&
		import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY &&
		import.meta.env.VITE_STACK_SECRET_SERVER_KEY;
}