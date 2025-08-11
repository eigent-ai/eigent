import { Result } from './results.js';

type ReactPromise<T> = Promise<T> & ({
    status: "rejected";
    reason: unknown;
} | {
    status: "fulfilled";
    value: T;
} | {
    status: "pending";
});
type Resolve<T> = (value: T) => void;
type Reject = (reason: unknown) => void;
declare function createPromise<T>(callback: (resolve: Resolve<T>, reject: Reject) => void): ReactPromise<T>;
/**
 * Like Promise.resolve(...), but also adds the status and value properties for use with React's `use` hook, and caches
 * the value so that invoking `resolved` twice returns the same promise.
 */
declare function resolved<T>(value: T): ReactPromise<T>;
/**
 * Like Promise.reject(...), but also adds the status and value properties for use with React's `use` hook, and caches
 * the value so that invoking `rejected` twice returns the same promise.
 */
declare function rejected<T>(reason: unknown): ReactPromise<T>;
declare function neverResolve(): ReactPromise<never>;
declare function pending<T>(promise: Promise<T>, options?: {
    disableErrorWrapping?: boolean;
}): ReactPromise<T>;
/**
 * Should be used to wrap Promises that are not immediately awaited, so they don't throw an unhandled promise rejection
 * error.
 *
 * Vercel kills serverless functions on unhandled promise rejection errors, so this is important.
 */
declare function ignoreUnhandledRejection<T extends Promise<any>>(promise: T): void;
declare function wait(ms: number): Promise<void>;
declare function waitUntil(date: Date): Promise<void>;
declare function runAsynchronouslyWithAlert(...args: Parameters<typeof runAsynchronously>): void;
declare function runAsynchronously(promiseOrFunc: void | Promise<unknown> | (() => void | Promise<unknown>) | undefined, options?: {
    noErrorLogging?: boolean;
    onError?: (error: Error) => void;
}): void;
declare class TimeoutError extends Error {
    readonly ms: number;
    constructor(ms: number);
}
declare function timeout<T>(promise: Promise<T>, ms: number): Promise<Result<T, TimeoutError>>;
declare function timeoutThrow<T>(promise: Promise<T>, ms: number): Promise<T>;
type RateLimitOptions = {
    /**
     * The number of requests to process in parallel. Currently only 1 is supported.
     */
    concurrency: 1;
    /**
     * If true, multiple requests waiting at the same time will be reduced to just one. Default is false.
     */
    batchCalls?: boolean;
    /**
     * Waits for throttleMs since the start of last request before starting the next request. Default is 0.
     */
    throttleMs?: number;
    /**
     * Waits for gapMs since the end of last request before starting the next request. Default is 0.
     */
    gapMs?: number;
    /**
     * Waits until there have been no new requests for debounceMs before starting a new request. Default is 0.
     */
    debounceMs?: number;
};
declare function rateLimited<T>(func: () => Promise<T>, options: RateLimitOptions): () => Promise<T>;
declare function throttled<T, A extends any[]>(func: (...args: A) => Promise<T>, delayMs: number): (...args: A) => Promise<T>;

export { type RateLimitOptions, type ReactPromise, createPromise, ignoreUnhandledRejection, neverResolve, pending, rateLimited, rejected, resolved, runAsynchronously, runAsynchronouslyWithAlert, throttled, timeout, timeoutThrow, wait, waitUntil };
