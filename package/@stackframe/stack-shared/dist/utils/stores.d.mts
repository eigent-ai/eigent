import { ReadWriteLock } from './locks.mjs';
import { ReactPromise } from './promises.mjs';
import { AsyncResult, Result } from './results.mjs';

type ReadonlyStore<T> = {
    get(): T;
    onChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
    onceChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
};
type AsyncStoreStateChangeCallback<T> = (args: {
    state: AsyncResult<T>;
    oldState: AsyncResult<T>;
    lastOkValue: T | undefined;
}) => void;
type ReadonlyAsyncStore<T> = {
    isAvailable(): boolean;
    get(): AsyncResult<T, unknown, void>;
    getOrWait(): ReactPromise<T>;
    onChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
    onceChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
    onStateChange(callback: AsyncStoreStateChangeCallback<T>): {
        unsubscribe: () => void;
    };
    onceStateChange(callback: AsyncStoreStateChangeCallback<T>): {
        unsubscribe: () => void;
    };
};
declare class Store<T> implements ReadonlyStore<T> {
    private _value;
    private readonly _callbacks;
    constructor(_value: T);
    get(): T;
    set(value: T): void;
    update(updater: (value: T) => T): T;
    onChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
    onceChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
}
declare const storeLock: ReadWriteLock;
declare class AsyncStore<T> implements ReadonlyAsyncStore<T> {
    private _isAvailable;
    private _mostRecentOkValue;
    private _isRejected;
    private _rejectionError;
    private readonly _waitingRejectFunctions;
    private readonly _callbacks;
    private _updateCounter;
    private _lastSuccessfulUpdate;
    constructor(...args: [] | [T]);
    isAvailable(): boolean;
    isRejected(): boolean;
    get(): ({
        status: "pending";
    } & {
        progress: void;
    } & {
        status: "pending";
    }) | ({
        status: "error";
        error: unknown;
    } & {
        status: "error";
    }) | ({
        status: "ok";
        data: T;
    } & {
        status: "ok";
    });
    getOrWait(): ReactPromise<T>;
    _setIfLatest(result: Result<T>, curCounter: number): boolean;
    set(value: T): void;
    update(updater: (value: T | undefined) => T): T;
    setAsync(promise: Promise<T>): Promise<boolean>;
    setUnavailable(): void;
    setRejected(error: unknown): void;
    map<U>(mapper: (value: T) => U): AsyncStore<U>;
    onChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
    onStateChange(callback: AsyncStoreStateChangeCallback<T>): {
        unsubscribe: () => void;
    };
    onceChange(callback: (value: T, oldValue: T | undefined) => void): {
        unsubscribe: () => void;
    };
    onceStateChange(callback: AsyncStoreStateChangeCallback<T>): {
        unsubscribe: () => void;
    };
}

export { AsyncStore, type AsyncStoreStateChangeCallback, type ReadonlyAsyncStore, type ReadonlyStore, Store, storeLock };
