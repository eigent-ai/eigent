"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/jwt.tsx
var jwt_exports = {};
__export(jwt_exports, {
  getKid: () => getKid,
  getPerAudienceSecret: () => getPerAudienceSecret,
  getPrivateJwk: () => getPrivateJwk,
  getPublicJwkSet: () => getPublicJwkSet,
  legacySignGlobalJWT: () => legacySignGlobalJWT,
  legacyVerifyGlobalJWT: () => legacyVerifyGlobalJWT,
  signJWT: () => signJWT,
  verifyJWT: () => verifyJWT
});
module.exports = __toCommonJS(jwt_exports);
var import_crypto = __toESM(require("crypto"));
var import_elliptic = __toESM(require("elliptic"));
var jose = __toESM(require("jose"));
var import_errors = require("jose/errors");
var import_bytes = require("./bytes");
var import_errors2 = require("./errors");
var import_globals = require("./globals");
var import_objects = require("./objects");
var STACK_SERVER_SECRET = process.env.STACK_SERVER_SECRET ?? "";
try {
  jose.base64url.decode(STACK_SERVER_SECRET);
} catch (e) {
  throw new Error("STACK_SERVER_SECRET is not valid. Please use the generateKeys script to generate a new secret.");
}
async function legacySignGlobalJWT(issuer, payload, expirationTime = "5m") {
  const privateJwk = await jose.importJWK(await getPrivateJwk(STACK_SERVER_SECRET));
  return await new jose.SignJWT(payload).setProtectedHeader({ alg: "ES256" }).setIssuer(issuer).setIssuedAt().setExpirationTime(expirationTime).sign(privateJwk);
}
async function legacyVerifyGlobalJWT(issuer, jwt) {
  const jwkSet = jose.createLocalJWKSet(await getPublicJwkSet(STACK_SERVER_SECRET));
  const verified = await jose.jwtVerify(jwt, jwkSet, { issuer });
  return verified.payload;
}
async function signJWT(options) {
  const secret = getPerAudienceSecret({ audience: options.audience, secret: STACK_SERVER_SECRET });
  const kid = getKid({ secret });
  const privateJwk = await jose.importJWK(await getPrivateJwk(secret));
  return await new jose.SignJWT(options.payload).setProtectedHeader({ alg: "ES256", kid }).setIssuer(options.issuer).setIssuedAt().setAudience(options.audience).setExpirationTime(options.expirationTime || "5m").sign(privateJwk);
}
async function verifyJWT(options) {
  const audience = jose.decodeJwt(options.jwt).aud;
  if (!audience || typeof audience !== "string") {
    throw new import_errors.JOSEError("Invalid JWT audience");
  }
  const secret = getPerAudienceSecret({ audience, secret: STACK_SERVER_SECRET });
  const jwkSet = jose.createLocalJWKSet(await getPublicJwkSet(secret));
  const verified = await jose.jwtVerify(options.jwt, jwkSet, { issuer: options.issuer });
  return verified.payload;
}
async function getPrivateJwk(secret) {
  const secretHash = await import_globals.globalVar.crypto.subtle.digest("SHA-256", jose.base64url.decode(secret));
  const priv = new Uint8Array(secretHash);
  const ec = new import_elliptic.default.ec("p256");
  const key = ec.keyFromPrivate(priv);
  const publicKey = key.getPublic();
  return {
    kty: "EC",
    crv: "P-256",
    alg: "ES256",
    kid: getKid({ secret }),
    d: (0, import_bytes.encodeBase64Url)(priv),
    x: (0, import_bytes.encodeBase64Url)(publicKey.getX().toBuffer()),
    y: (0, import_bytes.encodeBase64Url)(publicKey.getY().toBuffer())
  };
}
async function getPublicJwkSet(secretOrPrivateJwk) {
  const privateJwk = typeof secretOrPrivateJwk === "string" ? await getPrivateJwk(secretOrPrivateJwk) : secretOrPrivateJwk;
  const jwk = (0, import_objects.pick)(privateJwk, ["kty", "alg", "crv", "x", "y", "kid"]);
  return {
    keys: [jwk]
  };
}
function getPerAudienceSecret(options) {
  if (options.audience === "kid") {
    throw new import_errors2.StackAssertionError("You cannot use the 'kid' audience for a per-audience secret, see comment below in jwt.tsx");
  }
  return jose.base64url.encode(
    import_crypto.default.createHash("sha256").update(JSON.stringify([options.secret, options.audience])).digest()
  );
}
function getKid(options) {
  return jose.base64url.encode(
    import_crypto.default.createHash("sha256").update(JSON.stringify([options.secret, "kid"])).digest()
  ).slice(0, 12);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getKid,
  getPerAudienceSecret,
  getPrivateJwk,
  getPublicJwkSet,
  legacySignGlobalJWT,
  legacyVerifyGlobalJWT,
  signJWT,
  verifyJWT
});
//# sourceMappingURL=jwt.js.map