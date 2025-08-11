import React from 'react';

declare function forwardRefIfNeeded<T, P = {}>(render: React.ForwardRefRenderFunction<T, P>): React.FC<P & {
    ref?: React.Ref<T>;
}>;
declare function getNodeText(node: React.ReactNode): string;
/**
 * Suspends the currently rendered component indefinitely. Will not unsuspend unless the component rerenders.
 *
 * You can use this to translate older query- or AsyncResult-based code to new the Suspense system, for example: `if (query.isLoading) suspend();`
 */
declare function suspend(): never;
declare class NoSuspenseBoundaryError extends Error {
    digest: string;
    reason: string;
    constructor(options: {
        caller?: string;
    });
}
/**
 * Use this in a component or a hook to disable SSR. Should be wrapped in a Suspense boundary, or it will throw an error.
 */
declare function suspendIfSsr(caller?: string): void;

export { NoSuspenseBoundaryError, forwardRefIfNeeded, getNodeText, suspend, suspendIfSsr };
