// src/lib/cookie.ts
import { isBrowserLike } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import Cookies from "js-cookie";

// ../../node_modules/.pnpm/oauth4webapi@2.10.4/node_modules/oauth4webapi/build/index.js
var USER_AGENT;
if (typeof navigator === "undefined" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) {
  const NAME = "oauth4webapi";
  const VERSION = "v2.10.4";
  USER_AGENT = `${NAME}/${VERSION}`;
}
var clockSkew = Symbol();
var clockTolerance = Symbol();
var customFetch = Symbol();
var useMtlsAlias = Symbol();
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function buf(input) {
  if (typeof input === "string") {
    return encoder.encode(input);
  }
  return decoder.decode(input);
}
var CHUNK_SIZE = 32768;
function encodeBase64Url(input) {
  if (input instanceof ArrayBuffer) {
    input = new Uint8Array(input);
  }
  const arr = [];
  for (let i = 0; i < input.byteLength; i += CHUNK_SIZE) {
    arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(arr.join("")).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function decodeBase64Url(input) {
  try {
    const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (cause) {
    throw new OPE("The input to be decoded is not correctly encoded.", { cause });
  }
}
function b64u(input) {
  if (typeof input === "string") {
    return decodeBase64Url(input);
  }
  return encodeBase64Url(input);
}
var LRU = class {
  constructor(maxSize) {
    this.cache = /* @__PURE__ */ new Map();
    this._cache = /* @__PURE__ */ new Map();
    this.maxSize = maxSize;
  }
  get(key) {
    let v = this.cache.get(key);
    if (v) {
      return v;
    }
    if (v = this._cache.get(key)) {
      this.update(key, v);
      return v;
    }
    return void 0;
  }
  has(key) {
    return this.cache.has(key) || this._cache.has(key);
  }
  set(key, value) {
    if (this.cache.has(key)) {
      this.cache.set(key, value);
    } else {
      this.update(key, value);
    }
    return this;
  }
  delete(key) {
    if (this.cache.has(key)) {
      return this.cache.delete(key);
    }
    if (this._cache.has(key)) {
      return this._cache.delete(key);
    }
    return false;
  }
  update(key, value) {
    this.cache.set(key, value);
    if (this.cache.size >= this.maxSize) {
      this._cache = this.cache;
      this.cache = /* @__PURE__ */ new Map();
    }
  }
};
var OperationProcessingError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var OPE = OperationProcessingError;
var dpopNonces = new LRU(100);
function validateString(input) {
  return typeof input === "string" && input.length !== 0;
}
function randomBytes() {
  return b64u(crypto.getRandomValues(new Uint8Array(32)));
}
function generateRandomCodeVerifier() {
  return randomBytes();
}
function generateRandomState() {
  return randomBytes();
}
async function calculatePKCECodeChallenge(codeVerifier) {
  if (!validateString(codeVerifier)) {
    throw new TypeError('"codeVerifier" must be a non-empty string');
  }
  return b64u(await crypto.subtle.digest("SHA-256", buf(codeVerifier)));
}
var skipSubjectCheck = Symbol();
var expectNoNonce = Symbol();
var skipAuthTimeCheck = Symbol();
var noSignatureCheck = Symbol();
var skipStateCheck = Symbol();
var expectNoState = Symbol();

// src/lib/cookie.ts
function ensureClient() {
  if (!isBrowserLike()) {
    throw new Error("cookieClient functions can only be called in a browser environment, yet window is undefined");
  }
}
async function createPlaceholderCookieHelper() {
  function throwError() {
    throw new StackAssertionError("Throwing cookie helper is just a placeholder. This should never be called");
  }
  return {
    get: throwError,
    set: throwError,
    setOrDelete: throwError,
    delete: throwError
  };
}
async function createCookieHelper() {
  if (isBrowserLike()) {
    return createBrowserCookieHelper();
  } else {
    return await createPlaceholderCookieHelper();
  }
}
function createBrowserCookieHelper() {
  return {
    get: getCookieClient,
    set: setCookieClient,
    setOrDelete: setOrDeleteCookieClient,
    delete: deleteCookieClient
  };
}
function getCookieClient(name) {
  ensureClient();
  Cookies.set("stack-is-https", "true");
  return Cookies.get(name) ?? null;
}
async function getCookie(name) {
  const cookieHelper = await createCookieHelper();
  return cookieHelper.get(name);
}
function setOrDeleteCookieClient(name, value, options = {}) {
  ensureClient();
  if (value === null) {
    deleteCookieClient(name, options);
  } else {
    setCookieClient(name, value, options);
  }
}
async function setOrDeleteCookie(name, value, options = {}) {
  const cookieHelper = await createCookieHelper();
  cookieHelper.setOrDelete(name, value, options);
}
function deleteCookieClient(name, options = {}) {
  ensureClient();
  Cookies.remove(name);
}
async function deleteCookie(name, options = {}) {
  const cookieHelper = await createCookieHelper();
  cookieHelper.delete(name, options);
}
function setCookieClient(name, value, options = {}) {
  ensureClient();
  Cookies.set(name, value, {
    expires: options.maxAge === void 0 ? void 0 : new Date(Date.now() + options.maxAge * 1e3)
  });
}
async function setCookie(name, value, options = {}) {
  const cookieHelper = await createCookieHelper();
  cookieHelper.set(name, value, options);
}
async function saveVerifierAndState() {
  const codeVerifier = generateRandomCodeVerifier();
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const state = generateRandomState();
  await setCookie("stack-oauth-outer-" + state, codeVerifier, { maxAge: 60 * 60 });
  try{
    localStorage.setItem("stack-oauth-outer-", codeVerifier);
  }catch(e){
    console.log(e)
  }
  return {
    codeChallenge,
    state
  };
}
function consumeVerifierAndStateCookie(state) {
  ensureClient();
  const cookieName = "stack-oauth-outer-" + state;
  const codeVerifier = getCookieClient(cookieName);
  if (!codeVerifier) {
    return null;
  }
  deleteCookieClient(cookieName);
  return {
    codeVerifier
  };
}
export {
  consumeVerifierAndStateCookie,
  createBrowserCookieHelper,
  createCookieHelper,
  createPlaceholderCookieHelper,
  deleteCookie,
  deleteCookieClient,
  getCookie,
  getCookieClient,
  saveVerifierAndState,
  setCookie,
  setCookieClient,
  setOrDeleteCookie,
  setOrDeleteCookieClient
};
//# sourceMappingURL=cookie.js.map