// src/hooks/use-async-external-store.tsx
import { useEffect, useState } from "react";
import { AsyncResult } from "../utils/results";
function useAsyncExternalStore(subscribe) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [value, setValue] = useState();
  useEffect(() => {
    const unsubscribe = subscribe((value2) => {
      setValue(() => value2);
      setIsAvailable(() => true);
    });
    return unsubscribe;
  }, [subscribe]);
  if (isAvailable) {
    return AsyncResult.ok(value);
  } else {
    return AsyncResult.pending();
  }
}
export {
  useAsyncExternalStore
};
//# sourceMappingURL=use-async-external-store.js.map