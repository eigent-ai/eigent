// src/sessions.ts
import * as jose from "jose";
import { StackAssertionError } from "./utils/errors";
import { Store } from "./utils/stores";
var AccessToken = class {
  constructor(token) {
    this.token = token;
    if (token === "undefined") {
      throw new StackAssertionError("Access token is the string 'undefined'; it's unlikely this is the correct value. They're supposed to be unguessable!");
    }
  }
  get decoded() {
    return jose.decodeJwt(this.token);
  }
  get expiresAt() {
    const { exp } = this.decoded;
    if (exp === void 0) return /* @__PURE__ */ new Date(864e13);
    return new Date(exp * 1e3);
  }
  /**
   * @returns The number of milliseconds until the access token expires, or 0 if it has already expired.
   */
  get expiresInMillis() {
    return Math.max(0, this.expiresAt.getTime() - Date.now());
  }
  isExpired() {
    return this.expiresInMillis <= 0;
  }
};
var RefreshToken = class {
  constructor(token) {
    this.token = token;
    if (token === "undefined") {
      throw new StackAssertionError("Refresh token is the string 'undefined'; it's unlikely this is the correct value. They're supposed to be unguessable!");
    }
  }
};
var InternalSession = class _InternalSession {
  constructor(_options) {
    this._options = _options;
    /**
     * Whether the session as a whole is known to be invalid (ie. both access and refresh tokens are invalid). Used as a cache to avoid making multiple requests to the server (sessions never go back to being valid after being invalidated).
     *
     * It is possible for the access token to be invalid but the refresh token to be valid, in which case the session is
     * still valid (just needs a refresh). It is also possible for the access token to be valid but the refresh token to
     * be invalid, in which case the session is also valid (eg. if the refresh token is null because the user only passed
     * in an access token, eg. in a server-side request handler).
     */
    this._knownToBeInvalid = new Store(false);
    this._refreshPromise = null;
    this._accessToken = new Store(_options.accessToken ? new AccessToken(_options.accessToken) : null);
    this._refreshToken = _options.refreshToken ? new RefreshToken(_options.refreshToken) : null;
    if (_options.accessToken === null && _options.refreshToken === null) {
      this._knownToBeInvalid.set(true);
    }
    this.sessionKey = _InternalSession.calculateSessionKey({ accessToken: _options.accessToken ?? null, refreshToken: _options.refreshToken });
  }
  static calculateSessionKey(ofTokens) {
    if (ofTokens.refreshToken) {
      return `refresh-${ofTokens.refreshToken}`;
    } else if (ofTokens.accessToken) {
      return `access-${ofTokens.accessToken}`;
    } else {
      return "not-logged-in";
    }
  }
  isKnownToBeInvalid() {
    return this._knownToBeInvalid.get();
  }
  /**
   * Marks the session object as invalid, meaning that the refresh and access tokens can no longer be used.
   */
  markInvalid() {
    this._accessToken.set(null);
    this._knownToBeInvalid.set(true);
  }
  onInvalidate(callback) {
    return this._knownToBeInvalid.onChange(() => callback());
  }
  /**
   * Returns the access token if it is found in the cache, fetching it otherwise.
   *
   * This is usually the function you want to call to get an access token. Either set `minMillisUntilExpiration` to a reasonable value, or catch errors that occur if it expires, and call `markAccessTokenExpired` to mark the token as expired if so (after which a call to this function will always refetch the token).
   *
   * @returns null if the session is known to be invalid, cached tokens if they exist in the cache (which may or may not be valid still), or new tokens otherwise.
   */
  async getOrFetchLikelyValidTokens(minMillisUntilExpiration) {
    if (minMillisUntilExpiration >= 6e4) {
      throw new Error(`Required access token expiry ${minMillisUntilExpiration}ms is too long; access tokens are too short to be used for more than 60s`);
    }
    const accessToken = this._getPotentiallyInvalidAccessTokenIfAvailable();
    if (!accessToken || accessToken.expiresInMillis < minMillisUntilExpiration) {
      const newTokens = await this.fetchNewTokens();
      const expiresInMillis = newTokens?.accessToken.expiresInMillis;
      if (expiresInMillis && expiresInMillis < minMillisUntilExpiration) {
        throw new StackAssertionError(`Required access token expiry ${minMillisUntilExpiration}ms is too long; access tokens are too short when they're generated (${expiresInMillis}ms)`);
      }
      return newTokens;
    }
    return { accessToken, refreshToken: this._refreshToken };
  }
  /**
   * Fetches new tokens that are, at the time of fetching, guaranteed to be valid.
   *
   * The newly generated tokens are short-lived, so it's good practice not to rely on their validity (if possible). However, this function is useful in some cases where you only want to pass access tokens to a service, and you want to make sure said access token has the longest possible lifetime.
   *
   * In most cases, you should prefer `getOrFetchLikelyValidTokens`.
   *
   * @returns null if the session is known to be invalid, or new tokens otherwise (which, at the time of fetching, are guaranteed to be valid).
   */
  async fetchNewTokens() {
    const accessToken = await this._getNewlyFetchedAccessToken();
    return accessToken ? { accessToken, refreshToken: this._refreshToken } : null;
  }
  markAccessTokenExpired(accessToken) {
    if (this._accessToken.get() === accessToken) {
      this._accessToken.set(null);
    }
  }
  /**
   * Note that a callback invocation with `null` does not mean the session has been invalidated; the access token may just have expired. Use `onInvalidate` to detect invalidation.
   */
  onAccessTokenChange(callback) {
    return this._accessToken.onChange(callback);
  }
  /**
   * @returns An access token, which may be expired or expire soon, or null if it is known to be invalid.
   */
  _getPotentiallyInvalidAccessTokenIfAvailable() {
    if (!this._refreshToken) return null;
    if (this.isKnownToBeInvalid()) return null;
    const accessToken = this._accessToken.get();
    if (accessToken && !accessToken.isExpired()) return accessToken;
    return null;
  }
  /**
   * You should prefer `_getOrFetchPotentiallyInvalidAccessToken` in almost all cases.
   *
   * @returns A newly fetched access token (never read from cache), or null if the session either does not represent a user or the session is invalid.
   */
  async _getNewlyFetchedAccessToken() {
    if (!this._refreshToken) return null;
    if (this._knownToBeInvalid.get()) return null;
    if (!this._refreshPromise) {
      this._refreshAndSetRefreshPromise(this._refreshToken);
    }
    return await this._refreshPromise;
  }
  _refreshAndSetRefreshPromise(refreshToken) {
    let refreshPromise = this._options.refreshAccessTokenCallback(refreshToken).then((accessToken) => {
      if (refreshPromise === this._refreshPromise) {
        this._refreshPromise = null;
        this._accessToken.set(accessToken);
        if (!accessToken) {
          this.markInvalid();
        }
      }
      return accessToken;
    });
    this._refreshPromise = refreshPromise;
  }
};
export {
  AccessToken,
  InternalSession,
  RefreshToken
};
//# sourceMappingURL=sessions.js.map