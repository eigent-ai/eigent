// src/utils/node-http.tsx
import { IncomingMessage, ServerResponse } from "http";
import { getRelativePart } from "./urls";
var ServerResponseWithBodyChunks = class extends ServerResponse {
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
  const incomingMessage = new IncomingMessage({
    encrypted: options.originalUrl?.protocol === "https:"
    // trick frameworks into believing this is an HTTPS request
  });
  incomingMessage.httpVersionMajor = 1;
  incomingMessage.httpVersionMinor = 1;
  incomingMessage.httpVersion = "1.1";
  incomingMessage.method = options.method;
  incomingMessage.url = getRelativePart(options.url);
  incomingMessage.originalUrl = options.originalUrl && getRelativePart(options.originalUrl);
  const rawHeaders = [...options.headers.entries()].flat();
  incomingMessage._addHeaderLines(rawHeaders, rawHeaders.length);
  incomingMessage.push(Buffer.from(options.body));
  incomingMessage.complete = true;
  incomingMessage.push(null);
  const serverResponse = new ServerResponseWithBodyChunks(incomingMessage);
  return [incomingMessage, serverResponse];
}
export {
  createNodeHttpServerDuplex
};
//# sourceMappingURL=node-http.js.map