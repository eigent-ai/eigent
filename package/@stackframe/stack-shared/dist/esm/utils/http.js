// src/utils/http.tsx
import { decodeBase64, encodeBase64, isBase64 } from "./bytes";
var HTTP_METHODS = {
  "GET": {
    safe: true,
    idempotent: true
  },
  "POST": {
    safe: false,
    idempotent: false
  },
  "PUT": {
    safe: false,
    idempotent: true
  },
  "DELETE": {
    safe: false,
    idempotent: true
  },
  "PATCH": {
    safe: false,
    idempotent: false
  },
  "OPTIONS": {
    safe: true,
    idempotent: true
  },
  "HEAD": {
    safe: true,
    idempotent: true
  },
  "TRACE": {
    safe: true,
    idempotent: true
  },
  "CONNECT": {
    safe: false,
    idempotent: false
  }
};
function decodeBasicAuthorizationHeader(value) {
  const [type, encoded, ...rest] = value.split(" ");
  if (rest.length > 0) return null;
  if (!encoded) return null;
  if (type !== "Basic") return null;
  if (!isBase64(encoded)) return null;
  const decoded = new TextDecoder().decode(decodeBase64(encoded));
  const split = decoded.split(":");
  return [split[0], split.slice(1).join(":")];
}
function encodeBasicAuthorizationHeader(id, password) {
  if (id.includes(":")) throw new Error("Basic authorization header id cannot contain ':'");
  return `Basic ${encodeBase64(new TextEncoder().encode(`${id}:${password}`))}`;
}
export {
  HTTP_METHODS,
  decodeBasicAuthorizationHeader,
  encodeBasicAuthorizationHeader
};
//# sourceMappingURL=http.js.map