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

// src/utils/caches.tsx
var caches_exports = {};
__export(caches_exports, {
  AsyncCache: () => AsyncCache,
  cacheFunction: () => cacheFunction
});
module.exports = __toCommonJS(caches_exports);
var import_maps = require("./maps");
var import_objects = require("./objects");
var import_promises = require("./promises");
var import_stores = require("./stores");
function cacheFunction(f) {
  const dependenciesMap = new import_maps.DependenciesMap();
  return (...args) => {
    if (dependenciesMap.has(args)) {
      return dependenciesMap.get(args);
    }
    const value = f(...args);
    dependenciesMap.set(args, value);
    return value;
  };
}
var AsyncCache = class {
  constructor(_fetcher, _options = {}) {
    this._fetcher = _fetcher;
    this._options = _options;
    this._map = new import_maps.DependenciesMap();
    this.isCacheAvailable = this._createKeyed("isCacheAvailable");
    this.getIfCached = this._createKeyed("getIfCached");
    this.getOrWait = this._createKeyed("getOrWait");
    this.forceSetCachedValue = this._createKeyed("forceSetCachedValue");
    this.forceSetCachedValueAsync = this._createKeyed("forceSetCachedValueAsync");
    this.refresh = this._createKeyed("refresh");
    this.invalidate = this._createKeyed("invalidate");
    this.onStateChange = this._createKeyed("onStateChange");
  }
  _createKeyed(functionName) {
    return (key, ...args) => {
      const valueCache = this.getValueCache(key);
      return valueCache[functionName].apply(valueCache, args);
    };
  }
  getValueCache(dependencies) {
    let cache = this._map.get(dependencies);
    if (!cache) {
      cache = new AsyncValueCache(
        async () => await this._fetcher(dependencies),
        {
          ...this._options,
          onSubscribe: this._options.onSubscribe ? (cb) => this._options.onSubscribe(dependencies, cb) : void 0
        }
      );
      this._map.set(dependencies, cache);
    }
    return cache;
  }
  async refreshWhere(predicate) {
    const promises = [];
    for (const [dependencies, cache] of this._map) {
      if (predicate(dependencies)) {
        promises.push(cache.refresh());
      }
    }
    await Promise.all(promises);
  }
};
var AsyncValueCache = class {
  constructor(fetcher, _options = {}) {
    this._options = _options;
    this._subscriptionsCount = 0;
    this._unsubscribers = [];
    this._mostRecentRefreshPromiseIndex = 0;
    this._store = new import_stores.AsyncStore();
    this._rateLimitOptions = {
      concurrency: 1,
      throttleMs: 300,
      ...(0, import_objects.filterUndefined)(_options.rateLimiter ?? {})
    };
    this._fetcher = (0, import_promises.rateLimited)(fetcher, {
      ...this._rateLimitOptions,
      batchCalls: true
    });
  }
  isCacheAvailable() {
    return this._store.isAvailable();
  }
  getIfCached() {
    return this._store.get();
  }
  getOrWait(cacheStrategy) {
    const cached = this.getIfCached();
    if (cacheStrategy === "read-write" && cached.status === "ok") {
      return (0, import_promises.resolved)(cached.data);
    }
    return this._refetch(cacheStrategy);
  }
  _set(value) {
    this._store.set(value);
  }
  _setAsync(value) {
    const promise = (0, import_promises.pending)(value);
    this._pendingPromise = promise;
    return (0, import_promises.pending)(this._store.setAsync(promise));
  }
  _refetch(cacheStrategy) {
    if (cacheStrategy === "read-write" && this._pendingPromise) {
      return this._pendingPromise;
    }
    const promise = (0, import_promises.pending)(this._fetcher());
    if (cacheStrategy === "never") {
      return promise;
    }
    return (0, import_promises.pending)(this._setAsync(promise).then(() => promise));
  }
  forceSetCachedValue(value) {
    this._set(value);
  }
  forceSetCachedValueAsync(value) {
    return this._setAsync(value);
  }
  /**
   * Refetches the value from the fetcher, and updates the cache with it.
   */
  async refresh() {
    return await this.getOrWait("write-only");
  }
  /**
   * Invalidates the cache, marking it to refresh on the next read. If anyone was listening to it, it will refresh
   * immediately.
   */
  invalidate() {
    this._store.setUnavailable();
    this._pendingPromise = void 0;
    if (this._subscriptionsCount > 0) {
      (0, import_promises.runAsynchronously)(this.refresh());
    }
  }
  onStateChange(callback) {
    const storeObj = this._store.onChange(callback);
    (0, import_promises.runAsynchronously)(this.getOrWait("read-write"));
    if (this._subscriptionsCount++ === 0 && this._options.onSubscribe) {
      const unsubscribe = this._options.onSubscribe(() => {
        (0, import_promises.runAsynchronously)(this.refresh());
      });
      this._unsubscribers.push(unsubscribe);
    }
    let hasUnsubscribed = false;
    return {
      unsubscribe: () => {
        if (hasUnsubscribed) return;
        hasUnsubscribed = true;
        storeObj.unsubscribe();
        if (--this._subscriptionsCount === 0) {
          const currentRefreshPromiseIndex = ++this._mostRecentRefreshPromiseIndex;
          (0, import_promises.runAsynchronously)(async () => {
            await (0, import_promises.wait)(5e3);
            if (this._subscriptionsCount === 0 && currentRefreshPromiseIndex === this._mostRecentRefreshPromiseIndex) {
              this.invalidate();
            }
          });
          for (const unsubscribe of this._unsubscribers) {
            unsubscribe();
          }
        }
      }
    };
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AsyncCache,
  cacheFunction
});
//# sourceMappingURL=caches.js.map