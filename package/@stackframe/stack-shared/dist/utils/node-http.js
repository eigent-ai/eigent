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

// src/utils/node-http.tsx
var node_http_exports = {};
__export(node_http_exports, {
  createNodeHttpServerDuplex: () => createNodeHttpServerDuplex
});
module.exports = __toCommonJS(node_http_exports);
var import_http = require("http");
var import_urls = require("./urls");
var ServerResponseWithBodyChunks = class extends import_http.ServerResponse {
  constructor() {
    super(...arguments);
    this.bodyChunks = [];
  }
  // note: we actually override this, even though it's private in the parent
  _send(data, encoding, callback, byteLength) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = "utf-8";
    }
    const encodedBuffer = new Uint8Array(Buffer.from(data, encoding));
    this.bodyChunks.push(encodedBuffer);
    callback?.();
  }
};
async function createNodeHttpServerDuplex(options) {
  const incomingMessage = new import_http.IncomingMessage({
    encrypted: options.originalUrl?.protocol === "https:"
    // trick frameworks into believing this is an HTTPS request
  });
  incomingMessage.httpVersionMajor = 1;
  incomingMessage.httpVersionMinor = 1;
  incomingMessage.httpVersion = "1.1";
  incomingMessage.method = options.method;
  incomingMessage.url = (0, import_urls.getRelativePart)(options.url);
  incomingMessage.originalUrl = options.originalUrl && (0, import_urls.getRelativePart)(options.originalUrl);
  const rawHeaders = [...options.headers.entries()].flat();
  incomingMessage._addHeaderLines(rawHeaders, rawHeaders.length);
  incomingMessage.push(Buffer.from(options.body));
  incomingMessage.complete = true;
  incomingMessage.push(null);
  const serverResponse = new ServerResponseWithBodyChunks(incomingMessage);
  return [incomingMessage, serverResponse];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createNodeHttpServerDuplex
});
//# sourceMappingURL=node-http.js.map