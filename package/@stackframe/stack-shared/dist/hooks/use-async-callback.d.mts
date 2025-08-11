import React from 'react';

declare function useAsyncCallback<A extends any[], R>(callback: (...args: A) => Promise<R>, deps: React.DependencyList): [cb: (...args: A) => Promise<R>, loading: boolean, error: unknown | undefined];
declare function useAsyncCallbackWithLoggedError<A extends any[], R>(callback: (...args: A) => Promise<R>, deps: React.DependencyList): [cb: (...args: A) => Promise<R>, loading: boolean];

export { useAsyncCallback, useAsyncCallbackWithLoggedError };
