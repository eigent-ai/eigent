// ../../node_modules/.pnpm/oauth4webapi@2.10.4/node_modules/oauth4webapi/build/index.js
var USER_AGENT;
if (typeof navigator === "undefined" || !navigator.userAgent?.startsWith?.("Mozilla/5.0 ")) {
  const NAME = "oauth4webapi";
  const VERSION = "v2.10.4";
  USER_AGENT = `${NAME}/${VERSION}`;
}
function looseInstanceOf(input, expected) {
  if (input == null) {
    return false;
  }
  try {
    return input instanceof expected || Object.getPrototypeOf(input)[Symbol.toStringTag] === expected.prototype[Symbol.toStringTag];
  } catch {
    return false;
  }
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
var UnsupportedOperationError = class extends Error {
  constructor(message) {
    super(message ?? "operation not supported");
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
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
function isCryptoKey(key) {
  return key instanceof CryptoKey;
}
function isPrivateKey(key) {
  return isCryptoKey(key) && key.type === "private";
}
function isPublicKey(key) {
  return isCryptoKey(key) && key.type === "public";
}
function processDpopNonce(response) {
  try {
    const nonce = response.headers.get("dpop-nonce");
    if (nonce) {
      dpopNonces.set(new URL(response.url).origin, nonce);
    }
  } catch {
  }
  return response;
}
function isJsonObject(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  return true;
}
function prepareHeaders(input) {
  if (looseInstanceOf(input, Headers)) {
    input = Object.fromEntries(input.entries());
  }
  const headers = new Headers(input);
  if (USER_AGENT && !headers.has("user-agent")) {
    headers.set("user-agent", USER_AGENT);
  }
  if (headers.has("authorization")) {
    throw new TypeError('"options.headers" must not include the "authorization" header name');
  }
  if (headers.has("dpop")) {
    throw new TypeError('"options.headers" must not include the "dpop" header name');
  }
  return headers;
}
function signal(value) {
  if (typeof value === "function") {
    value = value();
  }
  if (!(value instanceof AbortSignal)) {
    throw new TypeError('"options.signal" must return or be an instance of AbortSignal');
  }
  return value;
}
function validateString(input) {
  return typeof input === "string" && input.length !== 0;
}
function randomBytes() {
  return b64u(crypto.getRandomValues(new Uint8Array(32)));
}
function getKeyAndKid(input) {
  if (input instanceof CryptoKey) {
    return { key: input };
  }
  if (!(input?.key instanceof CryptoKey)) {
    return {};
  }
  if (input.kid !== void 0 && !validateString(input.kid)) {
    throw new TypeError('"kid" must be a non-empty string');
  }
  return { key: input.key, kid: input.kid };
}
function formUrlEncode(token) {
  return encodeURIComponent(token).replace(/%20/g, "+");
}
function clientSecretBasic(clientId, clientSecret) {
  const username = formUrlEncode(clientId);
  const password = formUrlEncode(clientSecret);
  const credentials = btoa(`${username}:${password}`);
  return `Basic ${credentials}`;
}
function psAlg(key) {
  switch (key.algorithm.hash.name) {
    case "SHA-256":
      return "PS256";
    case "SHA-384":
      return "PS384";
    case "SHA-512":
      return "PS512";
    default:
      throw new UnsupportedOperationError("unsupported RsaHashedKeyAlgorithm hash name");
  }
}
function rsAlg(key) {
  switch (key.algorithm.hash.name) {
    case "SHA-256":
      return "RS256";
    case "SHA-384":
      return "RS384";
    case "SHA-512":
      return "RS512";
    default:
      throw new UnsupportedOperationError("unsupported RsaHashedKeyAlgorithm hash name");
  }
}
function esAlg(key) {
  switch (key.algorithm.namedCurve) {
    case "P-256":
      return "ES256";
    case "P-384":
      return "ES384";
    case "P-521":
      return "ES512";
    default:
      throw new UnsupportedOperationError("unsupported EcKeyAlgorithm namedCurve");
  }
}
function keyToJws(key) {
  switch (key.algorithm.name) {
    case "RSA-PSS":
      return psAlg(key);
    case "RSASSA-PKCS1-v1_5":
      return rsAlg(key);
    case "ECDSA":
      return esAlg(key);
    case "Ed25519":
    case "Ed448":
      return "EdDSA";
    default:
      throw new UnsupportedOperationError("unsupported CryptoKey algorithm name");
  }
}
function getClockSkew(client) {
  const skew = client?.[clockSkew];
  return typeof skew === "number" && Number.isFinite(skew) ? skew : 0;
}
function getClockTolerance(client) {
  const tolerance = client?.[clockTolerance];
  return typeof tolerance === "number" && Number.isFinite(tolerance) && Math.sign(tolerance) !== -1 ? tolerance : 30;
}
function epochTime() {
  return Math.floor(Date.now() / 1e3);
}
function clientAssertion(as, client) {
  const now = epochTime() + getClockSkew(client);
  return {
    jti: randomBytes(),
    aud: [as.issuer, as.token_endpoint],
    exp: now + 60,
    iat: now,
    nbf: now,
    iss: client.client_id,
    sub: client.client_id
  };
}
async function privateKeyJwt(as, client, key, kid) {
  return jwt({
    alg: keyToJws(key),
    kid
  }, clientAssertion(as, client), key);
}
function assertAs(as) {
  if (typeof as !== "object" || as === null) {
    throw new TypeError('"as" must be an object');
  }
  if (!validateString(as.issuer)) {
    throw new TypeError('"as.issuer" property must be a non-empty string');
  }
  return true;
}
function assertClient(client) {
  if (typeof client !== "object" || client === null) {
    throw new TypeError('"client" must be an object');
  }
  if (!validateString(client.client_id)) {
    throw new TypeError('"client.client_id" property must be a non-empty string');
  }
  return true;
}
function assertClientSecret(clientSecret) {
  if (!validateString(clientSecret)) {
    throw new TypeError('"client.client_secret" property must be a non-empty string');
  }
  return clientSecret;
}
function assertNoClientPrivateKey(clientAuthMethod, clientPrivateKey) {
  if (clientPrivateKey !== void 0) {
    throw new TypeError(`"options.clientPrivateKey" property must not be provided when ${clientAuthMethod} client authentication method is used.`);
  }
}
function assertNoClientSecret(clientAuthMethod, clientSecret) {
  if (clientSecret !== void 0) {
    throw new TypeError(`"client.client_secret" property must not be provided when ${clientAuthMethod} client authentication method is used.`);
  }
}
async function clientAuthentication(as, client, body, headers, clientPrivateKey) {
  body.delete("client_secret");
  body.delete("client_assertion_type");
  body.delete("client_assertion");
  switch (client.token_endpoint_auth_method) {
    case void 0:
    case "client_secret_basic": {
      assertNoClientPrivateKey("client_secret_basic", clientPrivateKey);
      headers.set("authorization", clientSecretBasic(client.client_id, assertClientSecret(client.client_secret)));
      break;
    }
    case "client_secret_post": {
      assertNoClientPrivateKey("client_secret_post", clientPrivateKey);
      body.set("client_id", client.client_id);
      body.set("client_secret", assertClientSecret(client.client_secret));
      break;
    }
    case "private_key_jwt": {
      assertNoClientSecret("private_key_jwt", client.client_secret);
      if (clientPrivateKey === void 0) {
        throw new TypeError('"options.clientPrivateKey" must be provided when "client.token_endpoint_auth_method" is "private_key_jwt"');
      }
      const { key, kid } = getKeyAndKid(clientPrivateKey);
      if (!isPrivateKey(key)) {
        throw new TypeError('"options.clientPrivateKey.key" must be a private CryptoKey');
      }
      body.set("client_id", client.client_id);
      body.set("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
      body.set("client_assertion", await privateKeyJwt(as, client, key, kid));
      break;
    }
    case "tls_client_auth":
    case "self_signed_tls_client_auth":
    case "none": {
      assertNoClientSecret(client.token_endpoint_auth_method, client.client_secret);
      assertNoClientPrivateKey(client.token_endpoint_auth_method, clientPrivateKey);
      body.set("client_id", client.client_id);
      break;
    }
    default:
      throw new UnsupportedOperationError("unsupported client token_endpoint_auth_method");
  }
}
async function jwt(header, claimsSet, key) {
  if (!key.usages.includes("sign")) {
    throw new TypeError('CryptoKey instances used for signing assertions must include "sign" in their "usages"');
  }
  const input = `${b64u(buf(JSON.stringify(header)))}.${b64u(buf(JSON.stringify(claimsSet)))}`;
  const signature = b64u(await crypto.subtle.sign(keyToSubtle(key), key, buf(input)));
  return `${input}.${signature}`;
}
async function dpopProofJwt(headers, options, url, htm, clockSkew2, accessToken) {
  const { privateKey, publicKey, nonce = dpopNonces.get(url.origin) } = options;
  if (!isPrivateKey(privateKey)) {
    throw new TypeError('"DPoP.privateKey" must be a private CryptoKey');
  }
  if (!isPublicKey(publicKey)) {
    throw new TypeError('"DPoP.publicKey" must be a public CryptoKey');
  }
  if (nonce !== void 0 && !validateString(nonce)) {
    throw new TypeError('"DPoP.nonce" must be a non-empty string or undefined');
  }
  if (!publicKey.extractable) {
    throw new TypeError('"DPoP.publicKey.extractable" must be true');
  }
  const now = epochTime() + clockSkew2;
  const proof = await jwt({
    alg: keyToJws(privateKey),
    typ: "dpop+jwt",
    jwk: await publicJwk(publicKey)
  }, {
    iat: now,
    jti: randomBytes(),
    htm,
    nonce,
    htu: `${url.origin}${url.pathname}`,
    ath: accessToken ? b64u(await crypto.subtle.digest("SHA-256", buf(accessToken))) : void 0
  }, privateKey);
  headers.set("dpop", proof);
}
var jwkCache;
async function getSetPublicJwkCache(key) {
  const { kty, e, n, x, y, crv } = await crypto.subtle.exportKey("jwk", key);
  const jwk = { kty, e, n, x, y, crv };
  jwkCache.set(key, jwk);
  return jwk;
}
async function publicJwk(key) {
  jwkCache || (jwkCache = /* @__PURE__ */ new WeakMap());
  return jwkCache.get(key) || getSetPublicJwkCache(key);
}
function validateEndpoint(value, endpoint, options) {
  if (typeof value !== "string") {
    if (options?.[useMtlsAlias]) {
      throw new TypeError(`"as.mtls_endpoint_aliases.${endpoint}" must be a string`);
    }
    throw new TypeError(`"as.${endpoint}" must be a string`);
  }
  return new URL(value);
}
function resolveEndpoint(as, endpoint, options) {
  if (options?.[useMtlsAlias] && as.mtls_endpoint_aliases && endpoint in as.mtls_endpoint_aliases) {
    return validateEndpoint(as.mtls_endpoint_aliases[endpoint], endpoint, options);
  }
  return validateEndpoint(as[endpoint], endpoint);
}
function isOAuth2Error(input) {
  const value = input;
  if (typeof value !== "object" || Array.isArray(value) || value === null) {
    return false;
  }
  return value.error !== void 0;
}
var skipSubjectCheck = Symbol();
async function authenticatedRequest(as, client, method, url, body, headers, options) {
  await clientAuthentication(as, client, body, headers, options?.clientPrivateKey);
  headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  return (options?.[customFetch] || fetch)(url.href, {
    body,
    headers: Object.fromEntries(headers.entries()),
    method,
    redirect: "manual",
    signal: options?.signal ? signal(options.signal) : null
  }).then(processDpopNonce);
}
async function tokenEndpointRequest(as, client, grantType, parameters, options) {
  const url = resolveEndpoint(as, "token_endpoint", options);
  parameters.set("grant_type", grantType);
  const headers = prepareHeaders(options?.headers);
  headers.set("accept", "application/json");
  if (options?.DPoP !== void 0) {
    await dpopProofJwt(headers, options.DPoP, url, "POST", getClockSkew(client));
  }
  return authenticatedRequest(as, client, "POST", url, parameters, headers, options);
}
async function refreshTokenGrantRequest(as, client, refreshToken, options) {
  assertAs(as);
  assertClient(client);
  if (!validateString(refreshToken)) {
    throw new TypeError('"refreshToken" must be a non-empty string');
  }
  const parameters = new URLSearchParams(options?.additionalParameters);
  parameters.set("refresh_token", refreshToken);
  return tokenEndpointRequest(as, client, "refresh_token", parameters, options);
}
var idTokenClaims = /* @__PURE__ */ new WeakMap();
async function processGenericAccessTokenResponse(as, client, response, ignoreIdToken = false, ignoreRefreshToken = false) {
  assertAs(as);
  assertClient(client);
  if (!looseInstanceOf(response, Response)) {
    throw new TypeError('"response" must be an instance of Response');
  }
  if (response.status !== 200) {
    let err;
    if (err = await handleOAuthBodyError(response)) {
      return err;
    }
    throw new OPE('"response" is not a conform Token Endpoint response');
  }
  assertReadableResponse(response);
  let json;
  try {
    json = await response.json();
  } catch (cause) {
    throw new OPE('failed to parse "response" body as JSON', { cause });
  }
  if (!isJsonObject(json)) {
    throw new OPE('"response" body must be a top level object');
  }
  if (!validateString(json.access_token)) {
    throw new OPE('"response" body "access_token" property must be a non-empty string');
  }
  if (!validateString(json.token_type)) {
    throw new OPE('"response" body "token_type" property must be a non-empty string');
  }
  json.token_type = json.token_type.toLowerCase();
  if (json.token_type !== "dpop" && json.token_type !== "bearer") {
    throw new UnsupportedOperationError("unsupported `token_type` value");
  }
  if (json.expires_in !== void 0 && (typeof json.expires_in !== "number" || json.expires_in <= 0)) {
    throw new OPE('"response" body "expires_in" property must be a positive number');
  }
  if (!ignoreRefreshToken && json.refresh_token !== void 0 && !validateString(json.refresh_token)) {
    throw new OPE('"response" body "refresh_token" property must be a non-empty string');
  }
  if (json.scope !== void 0 && typeof json.scope !== "string") {
    throw new OPE('"response" body "scope" property must be a string');
  }
  if (!ignoreIdToken) {
    if (json.id_token !== void 0 && !validateString(json.id_token)) {
      throw new OPE('"response" body "id_token" property must be a non-empty string');
    }
    if (json.id_token) {
      const { claims } = await validateJwt(json.id_token, checkSigningAlgorithm.bind(void 0, client.id_token_signed_response_alg, as.id_token_signing_alg_values_supported), noSignatureCheck, getClockSkew(client), getClockTolerance(client)).then(validatePresence.bind(void 0, ["aud", "exp", "iat", "iss", "sub"])).then(validateIssuer.bind(void 0, as.issuer)).then(validateAudience.bind(void 0, client.client_id));
      if (Array.isArray(claims.aud) && claims.aud.length !== 1 && claims.azp !== client.client_id) {
        throw new OPE('unexpected ID Token "azp" (authorized party) claim value');
      }
      if (client.require_auth_time && typeof claims.auth_time !== "number") {
        throw new OPE('unexpected ID Token "auth_time" (authentication time) claim value');
      }
      idTokenClaims.set(json, claims);
    }
  }
  return json;
}
async function processRefreshTokenResponse(as, client, response) {
  return processGenericAccessTokenResponse(as, client, response);
}
function validateAudience(expected, result) {
  if (Array.isArray(result.claims.aud)) {
    if (!result.claims.aud.includes(expected)) {
      throw new OPE('unexpected JWT "aud" (audience) claim value');
    }
  } else if (result.claims.aud !== expected) {
    throw new OPE('unexpected JWT "aud" (audience) claim value');
  }
  return result;
}
function validateIssuer(expected, result) {
  if (result.claims.iss !== expected) {
    throw new OPE('unexpected JWT "iss" (issuer) claim value');
  }
  return result;
}
var branded = /* @__PURE__ */ new WeakSet();
function brand(searchParams) {
  branded.add(searchParams);
  return searchParams;
}
async function authorizationCodeGrantRequest(as, client, callbackParameters, redirectUri, codeVerifier, options) {
  assertAs(as);
  assertClient(client);
  if (!branded.has(callbackParameters)) {
    throw new TypeError('"callbackParameters" must be an instance of URLSearchParams obtained from "validateAuthResponse()", or "validateJwtAuthResponse()');
  }
  if (!validateString(redirectUri)) {
    throw new TypeError('"redirectUri" must be a non-empty string');
  }
  if (!validateString(codeVerifier)) {
    throw new TypeError('"codeVerifier" must be a non-empty string');
  }
  const code = getURLSearchParameter(callbackParameters, "code");
  if (!code) {
    throw new OPE('no authorization code in "callbackParameters"');
  }
  const parameters = new URLSearchParams(options?.additionalParameters);
  parameters.set("redirect_uri", redirectUri);
  parameters.set("code_verifier", codeVerifier);
  parameters.set("code", code);
  return tokenEndpointRequest(as, client, "authorization_code", parameters, options);
}
var jwtClaimNames = {
  aud: "audience",
  c_hash: "code hash",
  client_id: "client id",
  exp: "expiration time",
  iat: "issued at",
  iss: "issuer",
  jti: "jwt id",
  nonce: "nonce",
  s_hash: "state hash",
  sub: "subject",
  ath: "access token hash",
  htm: "http method",
  htu: "http uri",
  cnf: "confirmation"
};
function validatePresence(required, result) {
  for (const claim of required) {
    if (result.claims[claim] === void 0) {
      throw new OPE(`JWT "${claim}" (${jwtClaimNames[claim]}) claim missing`);
    }
  }
  return result;
}
var expectNoNonce = Symbol();
var skipAuthTimeCheck = Symbol();
async function processAuthorizationCodeOAuth2Response(as, client, response) {
  const result = await processGenericAccessTokenResponse(as, client, response, true);
  if (isOAuth2Error(result)) {
    return result;
  }
  if (result.id_token !== void 0) {
    if (typeof result.id_token === "string" && result.id_token.length) {
      throw new OPE("Unexpected ID Token returned, use processAuthorizationCodeOpenIDResponse() for OpenID Connect callback processing");
    }
    delete result.id_token;
  }
  return result;
}
function assertReadableResponse(response) {
  if (response.bodyUsed) {
    throw new TypeError('"response" body has been used already');
  }
}
async function handleOAuthBodyError(response) {
  if (response.status > 399 && response.status < 500) {
    assertReadableResponse(response);
    try {
      const json = await response.json();
      if (isJsonObject(json) && typeof json.error === "string" && json.error.length) {
        if (json.error_description !== void 0 && typeof json.error_description !== "string") {
          delete json.error_description;
        }
        if (json.error_uri !== void 0 && typeof json.error_uri !== "string") {
          delete json.error_uri;
        }
        if (json.algs !== void 0 && typeof json.algs !== "string") {
          delete json.algs;
        }
        if (json.scope !== void 0 && typeof json.scope !== "string") {
          delete json.scope;
        }
        return json;
      }
    } catch {
    }
  }
  return void 0;
}
function checkRsaKeyAlgorithm(algorithm) {
  if (typeof algorithm.modulusLength !== "number" || algorithm.modulusLength < 2048) {
    throw new OPE(`${algorithm.name} modulusLength must be at least 2048 bits`);
  }
}
function ecdsaHashName(namedCurve) {
  switch (namedCurve) {
    case "P-256":
      return "SHA-256";
    case "P-384":
      return "SHA-384";
    case "P-521":
      return "SHA-512";
    default:
      throw new UnsupportedOperationError();
  }
}
function keyToSubtle(key) {
  switch (key.algorithm.name) {
    case "ECDSA":
      return {
        name: key.algorithm.name,
        hash: ecdsaHashName(key.algorithm.namedCurve)
      };
    case "RSA-PSS": {
      checkRsaKeyAlgorithm(key.algorithm);
      switch (key.algorithm.hash.name) {
        case "SHA-256":
        case "SHA-384":
        case "SHA-512":
          return {
            name: key.algorithm.name,
            saltLength: parseInt(key.algorithm.hash.name.slice(-3), 10) >> 3
          };
        default:
          throw new UnsupportedOperationError();
      }
    }
    case "RSASSA-PKCS1-v1_5":
      checkRsaKeyAlgorithm(key.algorithm);
      return key.algorithm.name;
    case "Ed448":
    case "Ed25519":
      return key.algorithm.name;
  }
  throw new UnsupportedOperationError();
}
var noSignatureCheck = Symbol();
async function validateJwt(jws, checkAlg, getKey, clockSkew2, clockTolerance2) {
  const { 0: protectedHeader, 1: payload, 2: encodedSignature, length } = jws.split(".");
  if (length === 5) {
    throw new UnsupportedOperationError("JWE structure JWTs are not supported");
  }
  if (length !== 3) {
    throw new OPE("Invalid JWT");
  }
  let header;
  try {
    header = JSON.parse(buf(b64u(protectedHeader)));
  } catch (cause) {
    throw new OPE("failed to parse JWT Header body as base64url encoded JSON", { cause });
  }
  if (!isJsonObject(header)) {
    throw new OPE("JWT Header must be a top level object");
  }
  checkAlg(header);
  if (header.crit !== void 0) {
    throw new OPE('unexpected JWT "crit" header parameter');
  }
  const signature = b64u(encodedSignature);
  let key;
  if (getKey !== noSignatureCheck) {
    key = await getKey(header);
    const input = `${protectedHeader}.${payload}`;
    const verified = await crypto.subtle.verify(keyToSubtle(key), key, signature, buf(input));
    if (!verified) {
      throw new OPE("JWT signature verification failed");
    }
  }
  let claims;
  try {
    claims = JSON.parse(buf(b64u(payload)));
  } catch (cause) {
    throw new OPE("failed to parse JWT Payload body as base64url encoded JSON", { cause });
  }
  if (!isJsonObject(claims)) {
    throw new OPE("JWT Payload must be a top level object");
  }
  const now = epochTime() + clockSkew2;
  if (claims.exp !== void 0) {
    if (typeof claims.exp !== "number") {
      throw new OPE('unexpected JWT "exp" (expiration time) claim type');
    }
    if (claims.exp <= now - clockTolerance2) {
      throw new OPE('unexpected JWT "exp" (expiration time) claim value, timestamp is <= now()');
    }
  }
  if (claims.iat !== void 0) {
    if (typeof claims.iat !== "number") {
      throw new OPE('unexpected JWT "iat" (issued at) claim type');
    }
  }
  if (claims.iss !== void 0) {
    if (typeof claims.iss !== "string") {
      throw new OPE('unexpected JWT "iss" (issuer) claim type');
    }
  }
  if (claims.nbf !== void 0) {
    if (typeof claims.nbf !== "number") {
      throw new OPE('unexpected JWT "nbf" (not before) claim type');
    }
    if (claims.nbf > now + clockTolerance2) {
      throw new OPE('unexpected JWT "nbf" (not before) claim value, timestamp is > now()');
    }
  }
  if (claims.aud !== void 0) {
    if (typeof claims.aud !== "string" && !Array.isArray(claims.aud)) {
      throw new OPE('unexpected JWT "aud" (audience) claim type');
    }
  }
  return { header, claims, signature, key };
}
function checkSigningAlgorithm(client, issuer, header) {
  if (client !== void 0) {
    if (header.alg !== client) {
      throw new OPE('unexpected JWT "alg" header parameter');
    }
    return;
  }
  if (Array.isArray(issuer)) {
    if (!issuer.includes(header.alg)) {
      throw new OPE('unexpected JWT "alg" header parameter');
    }
    return;
  }
  if (header.alg !== "RS256") {
    throw new OPE('unexpected JWT "alg" header parameter');
  }
}
function getURLSearchParameter(parameters, name) {
  const { 0: value, length } = parameters.getAll(name);
  if (length > 1) {
    throw new OPE(`"${name}" parameter must be provided only once`);
  }
  return value;
}
var skipStateCheck = Symbol();
var expectNoState = Symbol();
function validateAuthResponse(as, client, parameters, expectedState) {
  assertAs(as);
  assertClient(client);
  if (parameters instanceof URL) {
    parameters = parameters.searchParams;
  }
  if (!(parameters instanceof URLSearchParams)) {
    throw new TypeError('"parameters" must be an instance of URLSearchParams, or URL');
  }
  if (getURLSearchParameter(parameters, "response")) {
    throw new OPE('"parameters" contains a JARM response, use validateJwtAuthResponse() instead of validateAuthResponse()');
  }
  const iss = getURLSearchParameter(parameters, "iss");
  const state = getURLSearchParameter(parameters, "state");
  if (!iss && as.authorization_response_iss_parameter_supported) {
    throw new OPE('response parameter "iss" (issuer) missing');
  }
  if (iss && iss !== as.issuer) {
    throw new OPE('unexpected "iss" (issuer) response parameter value');
  }
  switch (expectedState) {
    case void 0:
    case expectNoState:
      if (state !== void 0) {
        throw new OPE('unexpected "state" response parameter encountered');
      }
      break;
    case skipStateCheck:
      break;
    default:
      if (!validateString(expectedState)) {
        throw new OPE('"expectedState" must be a non-empty string');
      }
      if (state === void 0) {
        throw new OPE('response parameter "state" missing');
      }
      if (state !== expectedState) {
        throw new OPE('unexpected "state" response parameter value');
      }
  }
  const error = getURLSearchParameter(parameters, "error");
  if (error) {
    return {
      error,
      error_description: getURLSearchParameter(parameters, "error_description"),
      error_uri: getURLSearchParameter(parameters, "error_uri")
    };
  }
  const id_token = getURLSearchParameter(parameters, "id_token");
  const token = getURLSearchParameter(parameters, "token");
  if (id_token !== void 0 || token !== void 0) {
    throw new UnsupportedOperationError("implicit and hybrid flows are not supported");
  }
  return brand(new URLSearchParams(parameters));
}

// src/interface/clientInterface.ts
import { KnownError, KnownErrors } from "../known-errors";
import { AccessToken, InternalSession } from "../sessions";
import { generateSecureRandomString } from "../utils/crypto";
import { StackAssertionError, throwErr } from "../utils/errors";
import { globalVar } from "../utils/globals";
import { HTTP_METHODS } from "../utils/http";
import { filterUndefined, filterUndefinedOrNull } from "../utils/objects";
import { wait } from "../utils/promises";
import { Result } from "../utils/results";
import { deindent } from "../utils/strings";
var StackClientInterface = class {
  constructor(options) {
    this.options = options;
  }
  get projectId() {
    return this.options.projectId;
  }
  getApiUrl() {
    return this.options.getBaseUrl() + "/api/v1";
  }
  async runNetworkDiagnostics(session, requestType) {
    const tryRequest = async (cb) => {
      try {
        await cb();
        return "OK";
      } catch (e) {
        return `${e}`;
      }
    };
    const cfTrace = await tryRequest(async () => {
      const res = await fetch("https://1.1.1.1/cdn-cgi/trace");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    const apiRoot = session !== void 0 && requestType !== void 0 ? await tryRequest(async () => {
      const res = await this.sendClientRequestInner("/", {}, session, requestType);
      if (res.status === "error") {
        throw res.error;
      }
    }) : "Not tested";
    const baseUrlBackend = await tryRequest(async () => {
      const res = await fetch(new URL("/health", this.getApiUrl()));
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    const prodDashboard = await tryRequest(async () => {
      const res = await fetch("https://app.stack-auth.com/health");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    const prodBackend = await tryRequest(async () => {
      const res = await fetch("https://api.stack-auth.com/health");
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
    });
    return {
      "navigator?.onLine": globalVar.navigator?.onLine,
      cfTrace,
      apiRoot,
      baseUrlBackend,
      prodDashboard,
      prodBackend
    };
  }
  async _createNetworkError(cause, session, requestType) {
    return new Error(deindent`
      Stack Auth is unable to connect to the server. Please check your internet connection and try again.
      
      If the problem persists, please contact support and provide a screenshot of your entire browser console.

      ${cause}
      
      ${JSON.stringify(await this.runNetworkDiagnostics(session, requestType), null, 2)}
    `, { cause });
  }
  async _networkRetry(cb, session, requestType) {
    const retriedResult = await Result.retry(
      cb,
      5,
      { exponentialDelayBase: 1e3 }
    );
    if (retriedResult.status === "error") {
      if (globalVar.navigator && !globalVar.navigator.onLine) {
        throw new Error("Failed to send Stack network request. It seems like you are offline, please check your internet connection and try again. This is not an error with Stack Auth. (window.navigator.onLine is falsy)", { cause: retriedResult.error });
      }
      throw await this._createNetworkError(retriedResult.error, session, requestType);
    }
    return retriedResult.data;
  }
  async _networkRetryException(cb, session, requestType) {
    return await this._networkRetry(async () => await Result.fromThrowingAsync(cb), session, requestType);
  }
  async fetchNewAccessToken(refreshToken) {
    if (!("publishableClientKey" in this.options)) {
      throw new Error("Admin session token is currently not supported for fetching new access token. Did you try to log in on a StackApp initiated with the admin session?");
    }
    const as = {
      issuer: this.options.getBaseUrl(),
      algorithm: "oauth2",
      token_endpoint: this.getApiUrl() + "/auth/oauth/token"
    };
    const client = {
      client_id: this.projectId,
      client_secret: this.options.publishableClientKey,
      token_endpoint_auth_method: "client_secret_post"
    };
    const rawResponse = await this._networkRetryException(
      async () => await refreshTokenGrantRequest(
        as,
        client,
        refreshToken.token
      )
    );
    const response = await this._processResponse(rawResponse);
    if (response.status === "error") {
      const error = response.error;
      if (KnownErrors.RefreshTokenError.isInstance(error)) {
        return null;
      }
      throw error;
    }
    if (!response.data.ok) {
      const body = await response.data.text();
      throw new Error(`Failed to send refresh token request: ${response.status} ${body}`);
    }
    const result = await processRefreshTokenResponse(as, client, response.data);
    if (isOAuth2Error(result)) {
      throw new StackAssertionError("OAuth error", { result });
    }
    if (!result.access_token) {
      throw new StackAssertionError("Access token not found in token endpoint response, this is weird!");
    }
    return new AccessToken(result.access_token);
  }
  async sendClientRequest(path, requestOptions, session, requestType = "client") {
    session ??= this.createSession({
      refreshToken: null
    });
    return await this._networkRetry(
      () => this.sendClientRequestInner(path, requestOptions, session, requestType),
      session,
      requestType
    );
  }
  createSession(options) {
    const session = new InternalSession({
      refreshAccessTokenCallback: async (refreshToken) => await this.fetchNewAccessToken(refreshToken),
      ...options
    });
    return session;
  }
  async sendClientRequestAndCatchKnownError(path, requestOptions, tokenStoreOrNull, errorsToCatch) {
    try {
      return Result.ok(await this.sendClientRequest(path, requestOptions, tokenStoreOrNull));
    } catch (e) {
      for (const errorType of errorsToCatch) {
        if (errorType.isInstance(e)) {
          return Result.error(e);
        }
      }
      throw e;
    }
  }
  async sendClientRequestInner(path, options, session, requestType) {
    let tokenObj = await session.getOrFetchLikelyValidTokens(2e4);
    let adminSession = "projectOwnerSession" in this.options ? this.options.projectOwnerSession : null;
    let adminTokenObj = adminSession ? await adminSession.getOrFetchLikelyValidTokens(2e4) : null;
    await this.options.prepareRequest?.();
    let url = this.getApiUrl() + path;
    if (url.endsWith("/")) {
      url = url.slice(0, -1);
    }
    const params = {
      /**
       * This fetch may be cross-origin, in which case we don't want to send cookies of the
       * original origin (this is the default behavior of `credentials`).
       *
       * To help debugging, also omit cookies on same-origin, so we don't accidentally
       * implement reliance on cookies anywhere.
       *
       * However, Cloudflare Workers don't actually support `credentials`, so we only set it
       * if Cloudflare-exclusive globals are not detected. https://github.com/cloudflare/workers-sdk/issues/2514
       */
      ..."WebSocketPair" in globalVar ? {} : {
        credentials: "omit"
      },
      ...options,
      headers: {
        "X-Stack-Override-Error-Status": "true",
        "X-Stack-Project-Id": this.projectId,
        "X-Stack-Access-Type": requestType,
        "X-Stack-Client-Version": this.options.clientVersion,
        ...tokenObj ? {
          "X-Stack-Access-Token": tokenObj.accessToken.token
        } : {},
        ...tokenObj?.refreshToken ? {
          "X-Stack-Refresh-Token": tokenObj.refreshToken.token
        } : {},
        ..."publishableClientKey" in this.options ? {
          "X-Stack-Publishable-Client-Key": this.options.publishableClientKey
        } : {},
        ...adminTokenObj ? {
          "X-Stack-Admin-Access-Token": adminTokenObj.accessToken.token
        } : {},
        /**
         * Next.js until v15 would cache fetch requests by default, and forcefully disabling it was nearly impossible.
         *
         * This header is used to change the cache key and hence always disable it, because we do our own caching.
         *
         * When we drop support for Next.js <15, we may be able to remove this header, but please make sure that this is
         * the case (I haven't actually tested.)
         */
        "X-Stack-Random-Nonce": generateSecureRandomString(),
        // don't show a warning when proxying the API through ngrok (only relevant if the API url is an ngrok site)
        "ngrok-skip-browser-warning": "true",
        ...this.options.extraRequestHeaders,
        ...options.headers
      },
      /**
       * Cloudflare Workers does not support cache, so don't pass it there
       */
      ..."WebSocketPair" in globalVar ? {} : {
        cache: "no-store"
      }
    };
    let rawRes;
    try {
      rawRes = await fetch(url, params);
    } catch (e) {
      if (e instanceof TypeError) {
        if (HTTP_METHODS[params.method ?? "GET"].idempotent) {
          return Result.error(e);
        } else {
          throw await this._createNetworkError(e, session, requestType);
        }
      }
      throw e;
    }
    const processedRes = await this._processResponse(rawRes);
    if (processedRes.status === "error") {
      if (KnownErrors.InvalidAccessToken.isInstance(processedRes.error)) {
        if (!tokenObj) {
          throw new StackAssertionError("Received invalid access token, but session is not logged in", { tokenObj, processedRes });
        }
        session.markAccessTokenExpired(tokenObj.accessToken);
        return Result.error(processedRes.error);
      }
      if (adminSession && (KnownErrors.InvalidAdminAccessToken.isInstance(processedRes.error) || KnownErrors.ApiKeyNotFound.isInstance(processedRes.error))) {
        if (!adminTokenObj) {
          throw new StackAssertionError("Received invalid admin access token, but admin session is not logged in", { adminTokenObj, processedRes });
        }
        adminSession.markAccessTokenExpired(adminTokenObj.accessToken);
        return Result.error(processedRes.error);
      }
      throw processedRes.error;
    }
    const res = Object.assign(processedRes.data, {
      usedTokens: tokenObj
    });
    if (res.ok) {
      return Result.ok(res);
    } else if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      if (retryAfter !== null) {
        console.log(`Rate limited while sending request to ${url}. Will retry after ${retryAfter} seconds...`);
        await wait(Number(retryAfter) * 1e3);
        return Result.error(new Error(`Rate limited, retrying after ${retryAfter} seconds`));
      }
      console.log(`Rate limited while sending request to ${url}, no retry-after header received. Retrying...`);
      return Result.error(new Error("Rate limited, no retry-after header received"));
    } else {
      const error = await res.text();
      const errorObj = new StackAssertionError(`Failed to send request to ${url}: ${res.status} ${error}`, { request: params, res, path });
      if (res.status === 508 && error.includes("INFINITE_LOOP_DETECTED")) {
        return Result.error(errorObj);
      }
      throw errorObj;
    }
  }
  async _processResponse(rawRes) {
    let res = rawRes;
    if (rawRes.headers.has("x-stack-actual-status")) {
      const actualStatus = Number(rawRes.headers.get("x-stack-actual-status"));
      res = new Response(rawRes.body, {
        status: actualStatus,
        statusText: rawRes.statusText,
        headers: rawRes.headers
      });
    }
    if (res.headers.has("x-stack-known-error")) {
      const errorJson = await res.json();
      if (res.headers.get("x-stack-known-error") !== errorJson.code) {
        throw new StackAssertionError("Mismatch between x-stack-known-error header and error code in body; the server's response is invalid");
      }
      const error = KnownError.fromJson(errorJson);
      return Result.error(error);
    }
    return Result.ok(res);
  }
  async checkFeatureSupport(options) {
    const res = await this.sendClientRequest("/check-feature-support", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(options)
    }, null);
    throw new StackAssertionError(await res.text());
  }
  async sendForgotPasswordEmail(email, callbackUrl) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/send-reset-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl
        })
      },
      null,
      [KnownErrors.UserNotFound]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(void 0);
    }
  }
  async sendVerificationEmail(email, callbackUrl, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/contact-channels/send-verification-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl
        })
      },
      session,
      [KnownErrors.EmailAlreadyVerified]
    );
    if (res.status === "error") {
      return res.error;
    }
  }
  async sendMagicLinkEmail(email, callbackUrl) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/otp/send-sign-in-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl
        })
      },
      null,
      [KnownErrors.RedirectUrlNotWhitelisted]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(await res.data.json());
    }
  }
  async resetPassword(options) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "onlyVerifyCode" in options ? "/auth/password/reset/check-code" : "/auth/password/reset",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: options.code,
          ..."password" in options ? { password: options.password } : {}
        })
      },
      null,
      [KnownErrors.VerificationCodeError]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(void 0);
    }
  }
  async updatePassword(options, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/update",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          old_password: options.oldPassword,
          new_password: options.newPassword
        })
      },
      session,
      [KnownErrors.PasswordConfirmationMismatch, KnownErrors.PasswordRequirementsNotMet]
    );
    if (res.status === "error") {
      return res.error;
    }
  }
  async setPassword(options, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/set",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options)
      },
      session,
      [KnownErrors.PasswordRequirementsNotMet]
    );
    if (res.status === "error") {
      return res.error;
    }
  }
  async verifyPasswordResetCode(code) {
    const res = await this.resetPassword({ code, onlyVerifyCode: true });
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(void 0);
    }
  }
  async verifyEmail(code) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/contact-channels/verify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code
        })
      },
      null,
      [KnownErrors.VerificationCodeError]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(void 0);
    }
  }
  async initiatePasskeyRegistration(options, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/initiate-passkey-registration",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options)
      },
      session,
      []
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    return Result.ok(await res.data.json());
  }
  async registerPasskey(options, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/register",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options)
      },
      session,
      [KnownErrors.PasskeyRegistrationFailed]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    return Result.ok(void 0);
  }
  async initiatePasskeyAuthentication(options, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/initiate-passkey-authentication",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(options)
      },
      session,
      []
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    return Result.ok(await res.data.json());
  }
  async sendTeamInvitation(options) {
    await this.sendClientRequest(
      "/team-invitations/send-code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: options.email,
          team_id: options.teamId,
          callback_url: options.callbackUrl
        })
      },
      options.session
    );
  }
  async acceptTeamInvitation(options) {
    const res = await this.sendClientRequestAndCatchKnownError(
      options.type === "check" ? "/team-invitations/accept/check-code" : options.type === "details" ? "/team-invitations/accept/details" : "/team-invitations/accept",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code: options.code
        })
      },
      options.session,
      [KnownErrors.VerificationCodeError]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    } else {
      return Result.ok(await res.data.json());
    }
  }
  async totpMfa(attemptCode, totp, session) {
    const res = await this.sendClientRequest("/auth/mfa/sign-in", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: attemptCode,
        type: "totp",
        totp
      })
    }, session);
    const result = await res.json();
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      newUser: result.is_new_user
    };
  }
  async signInWithCredential(email, password, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/sign-in",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password
        })
      },
      session,
      [KnownErrors.EmailPasswordMismatch]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token
    });
  }
  async signUpWithCredential(email, password, emailVerificationRedirectUrl, session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/password/sign-up",
      {
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST",
        body: JSON.stringify({
          email,
          password,
          verification_callback_url: emailVerificationRedirectUrl
        })
      },
      session,
      [KnownErrors.UserWithEmailAlreadyExists, KnownErrors.PasswordRequirementsNotMet]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token
    });
  }
  async signUpAnonymously(session) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/anonymous/sign-up",
      {
        method: "POST"
      },
      session,
      []
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token
    });
  }
  async signInWithMagicLink(code) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/otp/sign-in",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code
        })
      },
      null,
      [KnownErrors.VerificationCodeError]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      newUser: result.is_new_user
    });
  }
  async signInWithPasskey(body) {
    const res = await this.sendClientRequestAndCatchKnownError(
      "/auth/passkey/sign-in",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      null,
      [KnownErrors.PasskeyAuthenticationFailed]
    );
    if (res.status === "error") {
      return Result.error(res.error);
    }
    const result = await res.data.json();
    return Result.ok({
      accessToken: result.access_token,
      refreshToken: result.refresh_token
    });
  }
  async getOAuthUrl(options) {
    const updatedRedirectUrl = new URL(options.redirectUrl);
    for (const key of ["code", "state"]) {
      if (updatedRedirectUrl.searchParams.has(key)) {
        console.warn("Redirect URL already contains " + key + " parameter, removing it as it will be overwritten by the OAuth callback");
      }
      updatedRedirectUrl.searchParams.delete(key);
    }
    if (!("publishableClientKey" in this.options)) {
      throw new Error("Admin session token is currently not supported for OAuth");
    }
    const url = new URL(this.getApiUrl() + "/auth/oauth/authorize/" + options.provider.toLowerCase());
    url.searchParams.set("client_id", this.projectId);
    url.searchParams.set("client_secret", this.options.publishableClientKey);
    url.searchParams.set("redirect_uri", updatedRedirectUrl.toString());
    url.searchParams.set("scope", "legacy");
    url.searchParams.set("state", options.state);
    url.searchParams.set("grant_type", "authorization_code");
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("type", options.type);
    url.searchParams.set("error_redirect_url", options.errorRedirectUrl);
    if (options.afterCallbackRedirectUrl) {
      url.searchParams.set("after_callback_redirect_url", options.afterCallbackRedirectUrl);
    }
    if (options.type === "link") {
      const tokens = await options.session.getOrFetchLikelyValidTokens(2e4);
      url.searchParams.set("token", tokens?.accessToken.token || "");
      if (options.providerScope) {
        url.searchParams.set("provider_scope", options.providerScope);
      }
    }
    return url.toString();
  }
  async callOAuthCallback(options) {
    if (!("publishableClientKey" in this.options)) {
      throw new Error("Admin session token is currently not supported for OAuth");
    }
    const as = {
      issuer: this.options.getBaseUrl(),
      algorithm: "oauth2",
      token_endpoint: this.getApiUrl() + "/auth/oauth/token"
    };
    const client = {
      client_id: this.projectId,
      client_secret: this.options.publishableClientKey,
      token_endpoint_auth_method: "client_secret_post"
    };
    const params = await this._networkRetryException(
      async () => validateAuthResponse(as, client, options.oauthParams, options.state)
    );
    if (isOAuth2Error(params)) {
      throw new StackAssertionError("Error validating outer OAuth response", { params });
    }
    const response = await authorizationCodeGrantRequest(
      as,
      client,
      params,
      options.redirectUri,
      options.codeVerifier
    );
    const result = await processAuthorizationCodeOAuth2Response(as, client, response);
    if (isOAuth2Error(result)) {
      if ("code" in result && result.code === "MULTI_FACTOR_AUTHENTICATION_REQUIRED") {
        throw new KnownErrors.MultiFactorAuthenticationRequired(result.details.attempt_code);
      }
      throw new StackAssertionError("Outer OAuth error during authorization code response", { result });
    }
    return {
      newUser: result.is_new_user,
      afterCallbackRedirectUrl: result.after_callback_redirect_url,
      accessToken: result.access_token,
      refreshToken: result.refresh_token ?? throwErr("Refresh token not found in outer OAuth response")
    };
  }
  async signOut(session) {
    const tokenObj = await session.getOrFetchLikelyValidTokens(2e4);
    if (tokenObj) {
      const resOrError = await this.sendClientRequestAndCatchKnownError(
        "/auth/sessions/current",
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({})
        },
        session,
        [KnownErrors.RefreshTokenError]
      );
      if (resOrError.status === "error") {
        if (KnownErrors.RefreshTokenError.isInstance(resOrError.error)) {
        } else {
          throw new StackAssertionError("Unexpected error", { error: resOrError.error });
        }
      } else {
      }
    }
    session.markInvalid();
  }
  async getClientUserByToken(session) {
    const responseOrError = await this.sendClientRequestAndCatchKnownError(
      "/users/me",
      {},
      session,
      [KnownErrors.CannotGetOwnUserWithoutUser]
    );
    if (responseOrError.status === "error") {
      if (KnownErrors.CannotGetOwnUserWithoutUser.isInstance(responseOrError.error)) {
        return null;
      } else {
        throw new StackAssertionError("Unexpected uncaught error", { cause: responseOrError.error });
      }
    }
    const response = responseOrError.data;
    const user = await response.json();
    if (!user) throw new StackAssertionError("User endpoint returned null; this should never happen");
    return user;
  }
  async listTeamInvitations(options, session) {
    const response = await this.sendClientRequest(
      "/team-invitations?" + new URLSearchParams({ team_id: options.teamId }),
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async revokeTeamInvitation(invitationId, teamId, session) {
    await this.sendClientRequest(
      `/team-invitations/${invitationId}?team_id=${teamId}`,
      { method: "DELETE" },
      session
    );
  }
  async listTeamMemberProfiles(options, session) {
    const response = await this.sendClientRequest(
      "/team-member-profiles?" + new URLSearchParams(filterUndefined({
        team_id: options.teamId,
        user_id: options.userId
      })),
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async getTeamMemberProfile(options, session) {
    const response = await this.sendClientRequest(
      `/team-member-profiles/${options.teamId}/${options.userId}`,
      {},
      session
    );
    return await response.json();
  }
  async leaveTeam(teamId, session) {
    await this.sendClientRequest(
      `/team-memberships/${teamId}/me`,
      {
        method: "DELETE",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({})
      },
      session
    );
  }
  async updateTeamMemberProfile(options, session) {
    await this.sendClientRequest(
      `/team-member-profiles/${options.teamId}/${options.userId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(options.profile)
      },
      session
    );
  }
  async updateTeam(options, session) {
    await this.sendClientRequest(
      `/teams/${options.teamId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(options.data)
      },
      session
    );
  }
  async listCurrentUserTeamPermissions(options, session) {
    const response = await this.sendClientRequest(
      `/team-permissions?team_id=${options.teamId}&user_id=me&recursive=${options.recursive}`,
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async listCurrentUserProjectPermissions(options, session) {
    const response = await this.sendClientRequest(
      `/project-permissions?user_id=me&recursive=${options.recursive}`,
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async listCurrentUserTeams(session) {
    const response = await this.sendClientRequest(
      "/teams?user_id=me",
      {},
      session
    );
    const result = await response.json();
    return result.items;
  }
  async getClientProject() {
    const responseOrError = await this.sendClientRequestAndCatchKnownError("/projects/current", {}, null, [KnownErrors.ProjectNotFound]);
    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    const response = responseOrError.data;
    const project = await response.json();
    return Result.ok(project);
  }
  async updateClientUser(update, session) {
    await this.sendClientRequest(
      "/users/me",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(update)
      },
      session
    );
  }
  async listProjects(session) {
    const response = await this.sendClientRequest("/internal/projects", {}, session);
    if (!response.ok) {
      throw new Error("Failed to list projects: " + response.status + " " + await response.text());
    }
    const json = await response.json();
    return json.items;
  }
  async createProject(project, session) {
    const fetchResponse = await this.sendClientRequest(
      "/internal/projects",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(project)
      },
      session
    );
    if (!fetchResponse.ok) {
      throw new Error("Failed to create project: " + fetchResponse.status + " " + await fetchResponse.text());
    }
    const json = await fetchResponse.json();
    return json;
  }
  async createProviderAccessToken(provider, scope, session) {
    const response = await this.sendClientRequest(
      `/connected-accounts/me/${provider}/access-token`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ scope })
      },
      session
    );
    return await response.json();
  }
  async createClientTeam(data, session) {
    const response = await this.sendClientRequest(
      "/teams",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      session
    );
    return await response.json();
  }
  async deleteTeam(teamId, session) {
    await this.sendClientRequest(
      `/teams/${teamId}`,
      {
        method: "DELETE"
      },
      session
    );
  }
  async deleteCurrentUser(session) {
    await this.sendClientRequest(
      "/users/me",
      {
        method: "DELETE"
      },
      session
    );
  }
  async createClientContactChannel(data, session) {
    const response = await this.sendClientRequest(
      "/contact-channels",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      session
    );
    return await response.json();
  }
  async updateClientContactChannel(id, data, session) {
    const response = await this.sendClientRequest(
      `/contact-channels/me/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      session
    );
    return await response.json();
  }
  async deleteClientContactChannel(id, session) {
    await this.sendClientRequest(
      `/contact-channels/me/${id}`,
      {
        method: "DELETE"
      },
      session
    );
  }
  async deleteSession(sessionId, session) {
    await this.sendClientRequest(
      `/auth/sessions/${sessionId}?user_id=me`,
      {
        method: "DELETE"
      },
      session
    );
  }
  async listSessions(session) {
    const response = await this.sendClientRequest(
      "/auth/sessions?user_id=me",
      {
        method: "GET"
      },
      session
    );
    return await response.json();
  }
  async listClientContactChannels(session) {
    const response = await this.sendClientRequest(
      "/contact-channels?user_id=me",
      {
        method: "GET"
      },
      session
    );
    const json = await response.json();
    return json.items;
  }
  async sendCurrentUserContactChannelVerificationEmail(contactChannelId, callbackUrl, session) {
    const responseOrError = await this.sendClientRequestAndCatchKnownError(
      `/contact-channels/me/${contactChannelId}/send-verification-code`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ callback_url: callbackUrl })
      },
      session,
      [KnownErrors.EmailAlreadyVerified]
    );
    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    return Result.ok(void 0);
  }
  async cliLogin(loginCode, refreshToken, session) {
    const responseOrError = await this.sendClientRequestAndCatchKnownError(
      "/auth/cli/complete",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          login_code: loginCode,
          refresh_token: refreshToken
        })
      },
      session,
      [KnownErrors.SchemaError]
    );
    if (responseOrError.status === "error") {
      return Result.error(responseOrError.error);
    }
    return Result.ok(void 0);
  }
  async _getApiKeyRequestInfo(options) {
    if ("user_id" in options && "team_id" in options) {
      throw new StackAssertionError("Cannot specify both user_id and team_id in _getApiKeyRequestInfo");
    }
    return {
      endpoint: "team_id" in options ? "/team-api-keys" : "/user-api-keys",
      queryParams: new URLSearchParams(filterUndefinedOrNull(options))
    };
  }
  async listProjectApiKeys(options, session, requestType) {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : this.sendServerRequest).bind(this);
    const { endpoint, queryParams } = await this._getApiKeyRequestInfo(options);
    const response = await sendRequest(
      `${endpoint}?${queryParams.toString()}`,
      {
        method: "GET"
      },
      session,
      requestType
    );
    const json = await response.json();
    return json.items;
  }
  async createProjectApiKey(data, session, requestType) {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : this.sendServerRequest).bind(this);
    const { endpoint } = await this._getApiKeyRequestInfo(data);
    const response = await sendRequest(
      `${endpoint}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      session,
      requestType
    );
    return await response.json();
  }
  async getProjectApiKey(options, keyId, session, requestType) {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : this.sendServerRequest).bind(this);
    const { endpoint, queryParams } = await this._getApiKeyRequestInfo(options);
    const response = await sendRequest(
      `${endpoint}/${keyId}?${queryParams.toString()}`,
      {
        method: "GET"
      },
      session,
      requestType
    );
    return await response.json();
  }
  async updateProjectApiKey(options, keyId, data, session, requestType) {
    const sendRequest = (requestType === "client" ? this.sendClientRequest : this.sendServerRequest).bind(this);
    const { endpoint, queryParams } = await this._getApiKeyRequestInfo(options);
    const response = await sendRequest(
      `${endpoint}/${keyId}?${queryParams.toString()}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(data)
      },
      session,
      requestType
    );
    return await response.json();
  }
  async checkProjectApiKey(type, apiKey, session, requestType) {
    const sendRequest = (requestType === "client" ? this.sendClientRequestAndCatchKnownError : this.sendServerRequestAndCatchKnownError).bind(this);
    const result = await sendRequest(
      `/${type}-api-keys/check`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ api_key: apiKey })
      },
      session,
      [KnownErrors.ApiKeyNotValid]
    );
    if (result.status === "error") {
      return null;
    }
    return await result.data.json();
  }
};
export {
  StackClientInterface
};
//# sourceMappingURL=clientInterface.js.map