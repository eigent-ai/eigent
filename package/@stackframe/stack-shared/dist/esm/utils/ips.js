// src/utils/ips.tsx
import ipRegex from "ip-regex";
function isIpAddress(ip) {
  return ipRegex({ exact: true }).test(ip);
}
function assertIpAddress(ip) {
  if (!isIpAddress(ip)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
}
export {
  assertIpAddress,
  isIpAddress
};
//# sourceMappingURL=ips.js.map