// src/hooks/use-async-callback.tsx
import React from "react";
import { captureError } from "../utils/errors";
function useAsyncCallback(callback, deps) {
  const [error, setError] = React.useState(void 0);
  const [loadingCount, setLoadingCount] = React.useState(0);
  const cb = React.useCallback(
    async (...args) => {
      setLoadingCount((c) => c + 1);
      try {
        return await callback(...args);
      } catch (e) {
        setError(e);
        throw e;
      } finally {
        setLoadingCount((c) => c - 1);
      }
    },
    deps
  );
  return [cb, loadingCount > 0, error];
}
function useAsyncCallbackWithLoggedError(callback, deps) {
  const [newCallback, loading] = useAsyncCallback(async (...args) => {
    try {
      return await callback(...args);
    } catch (e) {
      captureError("async-callback", e);
      throw e;
    }
  }, deps);
  return [newCallback, loading];
}
export {
  useAsyncCallback,
  useAsyncCallbackWithLoggedError
};
//# sourceMappingURL=use-async-callback.js.map