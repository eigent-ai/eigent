import * as jose from 'jose';

declare function legacySignGlobalJWT(issuer: string, payload: any, expirationTime?: string): Promise<string>;
declare function legacyVerifyGlobalJWT(issuer: string, jwt: string): Promise<jose.JWTPayload>;
declare function signJWT(options: {
    issuer: string;
    audience: string;
    payload: any;
    expirationTime?: string;
}): Promise<string>;
declare function verifyJWT(options: {
    issuer: string;
    jwt: string;
}): Promise<jose.JWTPayload>;
type PrivateJwk = {
    kty: "EC";
    alg: "ES256";
    crv: "P-256";
    kid: string;
    d: string;
    x: string;
    y: string;
};
declare function getPrivateJwk(secret: string): Promise<PrivateJwk>;
type PublicJwk = {
    kty: "EC";
    alg: "ES256";
    crv: "P-256";
    kid: string;
    x: string;
    y: string;
};
declare function getPublicJwkSet(secretOrPrivateJwk: string | PrivateJwk): Promise<{
    keys: PublicJwk[];
}>;
declare function getPerAudienceSecret(options: {
    audience: string;
    secret: string;
}): string;
declare function getKid(options: {
    secret: string;
}): string;

export { type PrivateJwk, type PublicJwk, getKid, getPerAudienceSecret, getPrivateJwk, getPublicJwkSet, legacySignGlobalJWT, legacyVerifyGlobalJWT, signJWT, verifyJWT };
