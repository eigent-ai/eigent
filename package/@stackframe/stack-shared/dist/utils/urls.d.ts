declare function createUrlIfValid(...args: ConstructorParameters<typeof URL>): URL | null;
declare function isValidUrl(url: string): boolean;
declare function isValidHostname(hostname: string): boolean;
declare function isLocalhost(urlOrString: string | URL): boolean;
declare function isRelative(url: string): boolean;
declare function getRelativePart(url: URL): string;
/**
 * A template literal tag that returns a URL.
 *
 * Any values passed are encoded.
 */
declare function url(strings: TemplateStringsArray | readonly string[], ...values: (string | number | boolean)[]): URL;
/**
 * A template literal tag that returns a URL string.
 *
 * Any values passed are encoded.
 */
declare function urlString(strings: TemplateStringsArray | readonly string[], ...values: (string | number | boolean)[]): string;

export { createUrlIfValid, getRelativePart, isLocalhost, isRelative, isValidHostname, isValidUrl, url, urlString };
