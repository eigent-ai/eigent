// src/utils/urls.tsx
import { generateSecureRandomString } from "./crypto";
import { templateIdentity } from "./strings";
function createUrlIfValid(...args) {
  try {
    return new URL(...args);
  } catch (e) {
    return null;
  }
}
function isValidUrl(url2) {
  return !!createUrlIfValid(url2);
}
function isValidHostname(hostname) {
  const url2 = createUrlIfValid(`https://${hostname}`);
  if (!url2) return false;
  return url2.hostname === hostname;
}
function isLocalhost(urlOrString) {
  const url2 = createUrlIfValid(urlOrString);
  if (!url2) return false;
  if (url2.hostname === "localhost" || url2.hostname.endsWith(".localhost")) return true;
  if (url2.hostname.match(/^127\.\d+\.\d+\.\d+$/)) return true;
  return false;
}
function isRelative(url2) {
  const randomDomain = `${generateSecureRandomString()}.stack-auth.example.com`;
  const u = createUrlIfValid(url2, `https://${randomDomain}`);
  if (!u) return false;
  if (u.host !== randomDomain) return false;
  if (u.protocol !== "https:") return false;
  return true;
}
function getRelativePart(url2) {
  return url2.pathname + url2.search + url2.hash;
}
function url(strings, ...values) {
  return new URL(urlString(strings, ...values));
}
function urlString(strings, ...values) {
  return templateIdentity(strings, ...values.map(encodeURIComponent));
}
export {
  createUrlIfValid,
  getRelativePart,
  isLocalhost,
  isRelative,
  isValidHostname,
  isValidUrl,
  url,
  urlString
};
//# sourceMappingURL=urls.js.map