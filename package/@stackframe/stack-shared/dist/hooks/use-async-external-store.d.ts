import { AsyncResult } from '../utils/results.js';

declare function useAsyncExternalStore<T>(subscribe: (callback: (t: T) => void) => (() => void)): AsyncResult<T, never> & {
    status: "ok" | "pending";
};

export { useAsyncExternalStore };
