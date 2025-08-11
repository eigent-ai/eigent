// src/utils/jwt.tsx
import crypto from "crypto";
import elliptic from "elliptic";
import * as jose from "jose";
import { JOSEError } from "jose/errors";
import { encodeBase64Url } from "./bytes";
import { StackAssertionError } from "./errors";
import { globalVar } from "./globals";
import { pick } from "./objects";
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
    throw new JOSEError("Invalid JWT audience");
  }
  const secret = getPerAudienceSecret({ audience, secret: STACK_SERVER_SECRET });
  const jwkSet = jose.createLocalJWKSet(await getPublicJwkSet(secret));
  const verified = await jose.jwtVerify(options.jwt, jwkSet, { issuer: options.issuer });
  return verified.payload;
}
async function getPrivateJwk(secret) {
  const secretHash = await globalVar.crypto.subtle.digest("SHA-256", jose.base64url.decode(secret));
  const priv = new Uint8Array(secretHash);
  const ec = new elliptic.ec("p256");
  const key = ec.keyFromPrivate(priv);
  const publicKey = key.getPublic();
  return {
    kty: "EC",
    crv: "P-256",
    alg: "ES256",
    kid: getKid({ secret }),
    d: encodeBase64Url(priv),
    x: encodeBase64Url(publicKey.getX().toBuffer()),
    y: encodeBase64Url(publicKey.getY().toBuffer())
  };
}
async function getPublicJwkSet(secretOrPrivateJwk) {
  const privateJwk = typeof secretOrPrivateJwk === "string" ? await getPrivateJwk(secretOrPrivateJwk) : secretOrPrivateJwk;
  const jwk = pick(privateJwk, ["kty", "alg", "crv", "x", "y", "kid"]);
  return {
    keys: [jwk]
  };
}
function getPerAudienceSecret(options) {
  if (options.audience === "kid") {
    throw new StackAssertionError("You cannot use the 'kid' audience for a per-audience secret, see comment below in jwt.tsx");
  }
  return jose.base64url.encode(
    crypto.createHash("sha256").update(JSON.stringify([options.secret, options.audience])).digest()
  );
}
function getKid(options) {
  return jose.base64url.encode(
    crypto.createHash("sha256").update(JSON.stringify([options.secret, "kid"])).digest()
  ).slice(0, 12);
}
export {
  getKid,
  getPerAudienceSecret,
  getPrivateJwk,
  getPublicJwkSet,
  legacySignGlobalJWT,
  legacyVerifyGlobalJWT,
  signJWT,
  verifyJWT
};
//# sourceMappingURL=jwt.js.map