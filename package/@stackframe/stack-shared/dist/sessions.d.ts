import * as jose from 'jose';

declare class AccessToken {
    readonly token: string;
    constructor(token: string);
    get decoded(): jose.JWTPayload;
    get expiresAt(): Date;
    /**
     * @returns The number of milliseconds until the access token expires, or 0 if it has already expired.
     */
    get expiresInMillis(): number;
    isExpired(): boolean;
}
declare class RefreshToken {
    readonly token: string;
    constructor(token: string);
}
/**
 * An InternalSession represents a user's session, which may or may not be valid. It may contain an access token, a refresh token, or both.
 *
 * A session never changes which user or session it belongs to, but the tokens in it may change over time.
 */
declare class InternalSession {
    private readonly _options;
    /**
    * Each session has a session key that depends on the tokens inside. If the session has a refresh token, the session key depends only on the refresh token. If the session does not have a refresh token, the session key depends only on the access token.
    *
    * Multiple Session objects may have the same session key, which implies that they represent the same session by the same user. Furthermore, a session's key never changes over the lifetime of a session object.
    *
    * This is useful for caching and indexing sessions.
    */
    readonly sessionKey: string;
    /**
     * An access token that is not known to be invalid (ie. may be valid, but may have expired).
     */
    private _accessToken;
    private readonly _refreshToken;
    /**
     * Whether the session as a whole is known to be invalid (ie. both access and refresh tokens are invalid). Used as a cache to avoid making multiple requests to the server (sessions never go back to being valid after being invalidated).
     *
     * It is possible for the access token to be invalid but the refresh token to be valid, in which case the session is
     * still valid (just needs a refresh). It is also possible for the access token to be valid but the refresh token to
     * be invalid, in which case the session is also valid (eg. if the refresh token is null because the user only passed
     * in an access token, eg. in a server-side request handler).
     */
    private _knownToBeInvalid;
    private _refreshPromise;
    constructor(_options: {
        refreshAccessTokenCallback(refreshToken: RefreshToken): Promise<AccessToken | null>;
        refreshToken: string | null;
        accessToken?: string | null;
    });
    static calculateSessionKey(ofTokens: {
        refreshToken: string | null;
        accessToken?: string | null;
    }): string;
    isKnownToBeInvalid(): boolean;
    /**
     * Marks the session object as invalid, meaning that the refresh and access tokens can no longer be used.
     */
    markInvalid(): void;
    onInvalidate(callback: () => void): {
        unsubscribe: () => void;
    };
    /**
     * Returns the access token if it is found in the cache, fetching it otherwise.
     *
     * This is usually the function you want to call to get an access token. Either set `minMillisUntilExpiration` to a reasonable value, or catch errors that occur if it expires, and call `markAccessTokenExpired` to mark the token as expired if so (after which a call to this function will always refetch the token).
     *
     * @returns null if the session is known to be invalid, cached tokens if they exist in the cache (which may or may not be valid still), or new tokens otherwise.
     */
    getOrFetchLikelyValidTokens(minMillisUntilExpiration: number): Promise<{
        accessToken: AccessToken;
        refreshToken: RefreshToken | null;
    } | null>;
    /**
     * Fetches new tokens that are, at the time of fetching, guaranteed to be valid.
     *
     * The newly generated tokens are short-lived, so it's good practice not to rely on their validity (if possible). However, this function is useful in some cases where you only want to pass access tokens to a service, and you want to make sure said access token has the longest possible lifetime.
     *
     * In most cases, you should prefer `getOrFetchLikelyValidTokens`.
     *
     * @returns null if the session is known to be invalid, or new tokens otherwise (which, at the time of fetching, are guaranteed to be valid).
     */
    fetchNewTokens(): Promise<{
        accessToken: AccessToken;
        refreshToken: RefreshToken | null;
    } | null>;
    markAccessTokenExpired(accessToken: AccessToken): void;
    /**
     * Note that a callback invocation with `null` does not mean the session has been invalidated; the access token may just have expired. Use `onInvalidate` to detect invalidation.
     */
    onAccessTokenChange(callback: (newAccessToken: AccessToken | null) => void): {
        unsubscribe: () => void;
    };
    /**
     * @returns An access token, which may be expired or expire soon, or null if it is known to be invalid.
     */
    private _getPotentiallyInvalidAccessTokenIfAvailable;
    /**
     * You should prefer `_getOrFetchPotentiallyInvalidAccessToken` in almost all cases.
     *
     * @returns A newly fetched access token (never read from cache), or null if the session either does not represent a user or the session is invalid.
     */
    private _getNewlyFetchedAccessToken;
    private _refreshAndSetRefreshPromise;
}

export { AccessToken, InternalSession, RefreshToken };
