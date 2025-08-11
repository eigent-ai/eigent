import { RateLimitOptions, ReactPromise } from './promises.mjs';
import './results.mjs';

/**
 * Can be used to cache the result of a function call, for example for the `use` hook in React.
 */
declare function cacheFunction<F extends Function>(f: F): F;
type CacheStrategy = "write-only" | "read-write" | "never";
declare class AsyncCache<D extends any[], T> {
    private readonly _fetcher;
    private readonly _options;
    private readonly _map;
    constructor(_fetcher: (dependencies: D) => Promise<T>, _options?: {
        onSubscribe?: (key: D, refresh: () => void) => (() => void);
        rateLimiter?: Omit<RateLimitOptions, "batchCalls">;
    });
    private _createKeyed;
    getValueCache(dependencies: D): AsyncValueCache<T>;
    refreshWhere(predicate: (dependencies: D) => boolean): Promise<void>;
    readonly isCacheAvailable: (key: D) => boolean;
    readonly getIfCached: (key: D) => ({
        status: "error";
        error: unknown;
    } & {
        status: "error";
    }) | ({
        status: "pending";
    } & {
        progress: void;
    } & {
        status: "pending";
    }) | ({
        status: "ok";
        data: T;
    } & {
        status: "ok";
    });
    readonly getOrWait: (key: D, cacheStrategy: CacheStrategy) => ReactPromise<T>;
    readonly forceSetCachedValue: (key: D, value: T) => void;
    readonly forceSetCachedValueAsync: (key: D, value: Promise<T>) => ReactPromise<boolean>;
    readonly refresh: (key: D) => Promise<T>;
    readonly invalidate: (key: D) => void;
    readonly onStateChange: (key: D, callback: (value: T, oldValue: T | undefined) => void) => {
        unsubscribe: () => void;
    };
}
declare class AsyncValueCache<T> {
    private readonly _options;
    private _store;
    private _pendingPromise;
    private _fetcher;
    private readonly _rateLimitOptions;
    private _subscriptionsCount;
    private _unsubscribers;
    private _mostRecentRefreshPromiseIndex;
    constructor(fetcher: () => Promise<T>, _options?: {
        onSubscribe?: (refresh: () => void) => (() => void);
        rateLimiter?: Omit<RateLimitOptions, "batchCalls">;
    });
    isCacheAvailable(): boolean;
    getIfCached(): ({
        status: "error";
        error: unknown;
    } & {
        status: "error";
    }) | ({
        status: "pending";
    } & {
        progress: void;
    } & {
        status: "pending";
    }) | ({
        status: "ok";
        data: T;
    } & {
        status: "ok";
    });
    getOrWait(cacheStrategy: CacheStrategy): ReactPromise<T>;
    private _set;
    private _setAsync;
    private _refetch;
    forceSetCachedValue(value: T): void;
    forceSetCachedValueAsync(value: Promise<T>): ReactPromise<boolean>;
    /**
     * Refetches the value from the fetcher, and updates the cache with it.
     */
    refresh(): Promise<T>;
    /**
     * Invalidates the cache, marking it to refresh on the next read. If anyone was listening to it, it will refresh
     * immediately.
     */
    invalidate(): void;
    onStateChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
}

export { AsyncCache, cacheFunction };
