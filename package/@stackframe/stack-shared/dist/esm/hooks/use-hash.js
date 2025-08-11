// src/hooks/use-hash.tsx
import { useSyncExternalStore } from "react";
import { suspendIfSsr } from "../utils/react";
var useHash = () => {
  suspendIfSsr("useHash");
  return useSyncExternalStore(
    (onChange) => {
      const interval = setInterval(() => onChange(), 10);
      return () => clearInterval(interval);
    },
    () => window.location.hash.substring(1)
  );
};
export {
  useHash
};
//# sourceMappingURL=use-hash.js.map