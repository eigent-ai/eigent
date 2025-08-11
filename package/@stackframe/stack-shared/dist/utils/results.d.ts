type Result<T, E = unknown> = {
    status: "ok";
    data: T;
} | {
    status: "error";
    error: E;
};
declare const Result: {
    fromThrowing: typeof fromThrowing;
    fromThrowingAsync: typeof fromThrowingAsync;
    fromPromise: typeof promiseToResult;
    ok<T>(data: T): {
        status: "ok";
        data: T;
    } & {
        status: "ok";
    };
    error<E>(error: E): {
        status: "error";
        error: E;
    } & {
        status: "error";
    };
    map: typeof mapResult;
    or: <T_1, E_1, U>(result: Result<T_1, E_1>, fallback: U) => T_1 | U;
    orThrow: <T_2, E_2>(result: Result<T_2, E_2>) => T_2;
    orThrowAsync: <T_3, E_3>(result: Promise<Result<T_3, E_3>>) => Promise<T_3>;
    retry: typeof retry;
};
type AsyncResult<T, E = unknown, P = void> = Result<T, E> | ({
    status: "pending";
} & {
    progress: P;
});
declare const AsyncResult: {
    fromThrowing: typeof fromThrowing;
    fromPromise: typeof promiseToResult;
    ok: <T>(data: T) => {
        status: "ok";
        data: T;
    } & {
        status: "ok";
    };
    error: <E>(error: E) => {
        status: "error";
        error: E;
    } & {
        status: "error";
    };
    pending: typeof pending;
    map: typeof mapResult;
    or: <T_1, E_1, P, U>(result: AsyncResult<T_1, E_1, P>, fallback: U) => T_1 | U;
    orThrow: <T_2, E_2, P_1>(result: AsyncResult<T_2, E_2, P_1>) => T_2;
    retry: typeof retry;
};
declare function pending(): AsyncResult<never, never, void> & {
    status: "pending";
};
declare function pending<P>(progress: P): AsyncResult<never, never, P> & {
    status: "pending";
};
declare function promiseToResult<T>(promise: Promise<T>): Promise<Result<T>>;
declare function fromThrowing<T>(fn: () => T): Result<T, unknown>;
declare function fromThrowingAsync<T>(fn: () => Promise<T>): Promise<Result<T, unknown>>;
declare function mapResult<T, U, E = unknown, P = unknown>(result: Result<T, E>, fn: (data: T) => U): Result<U, E>;
declare function mapResult<T, U, E = unknown, P = unknown>(result: AsyncResult<T, E, P>, fn: (data: T) => U): AsyncResult<U, E, P>;
declare class RetryError extends AggregateError {
    readonly errors: unknown[];
    constructor(errors: unknown[]);
    get attempts(): number;
}
declare function retry<T>(fn: (attemptIndex: number) => Result<T> | Promise<Result<T>>, totalAttempts: number, { exponentialDelayBase }?: {
    exponentialDelayBase?: number | undefined;
}): Promise<Result<T, RetryError> & {
    attempts: number;
}>;

export { AsyncResult, Result };
