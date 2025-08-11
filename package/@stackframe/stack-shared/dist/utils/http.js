"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/http.tsx
var http_exports = {};
__export(http_exports, {
  HTTP_METHODS: () => HTTP_METHODS,
  decodeBasicAuthorizationHeader: () => decodeBasicAuthorizationHeader,
  encodeBasicAuthorizationHeader: () => encodeBasicAuthorizationHeader
});
module.exports = __toCommonJS(http_exports);
var import_bytes = require("./bytes");
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
  if (!(0, import_bytes.isBase64)(encoded)) return null;
  const decoded = new TextDecoder().decode((0, import_bytes.decodeBase64)(encoded));
  const split = decoded.split(":");
  return [split[0], split.slice(1).join(":")];
}
function encodeBasicAuthorizationHeader(id, password) {
  if (id.includes(":")) throw new Error("Basic authorization header id cannot contain ':'");
  return `Basic ${(0, import_bytes.encodeBase64)(new TextEncoder().encode(`${id}:${password}`))}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  HTTP_METHODS,
  decodeBasicAuthorizationHeader,
  encodeBasicAuthorizationHeader
});
//# sourceMappingURL=http.js.map