// src/lib/hooks.tsx
import { useContext } from "react";
import { StackContext } from "../providers/stack-provider-client";
function useUser(options = {}) {
  const stackApp = useStackApp(options);
  if (options.projectIdMustMatch && stackApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useStackApp: " + stackApp.projectId);
  }
  if (options.projectIdMustMatch === "internal") {
    return stackApp.useUser(options);
  } else {
    return stackApp.useUser(options);
  }
}
function useStackApp(options = {}) {
  const context = useContext(StackContext);
  if (context === null) {
    throw new Error("useStackApp must be used within a StackProvider");
  }
  const stackApp = context.app;
  if (options.projectIdMustMatch && stackApp.projectId !== options.projectIdMustMatch) {
    throw new Error("Unexpected project ID in useStackApp: " + stackApp.projectId);
  }
  return stackApp;
}
export {
  useStackApp,
  useUser
};
//# sourceMappingURL=hooks.js.map