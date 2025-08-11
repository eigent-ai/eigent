"use client";
"use client";

// src/providers/stack-provider-client.tsx
import { globalVar } from "@stackframe/stack-shared/dist/utils/globals";
import React, { useEffect } from "react";
import { useStackApp } from "..";
import { StackClientApp, stackAppInternalsSymbol } from "../lib/stack-app";
import { jsx } from "react/jsx-runtime";
var StackContext = React.createContext(null);
function StackProviderClient(props) {
  const app = props.serialized ? StackClientApp[stackAppInternalsSymbol].fromClientJson(props.app) : props.app;
  globalVar.__STACK_AUTH__ = { app };
  return /* @__PURE__ */ jsx(StackContext.Provider, { value: { app }, children: props.children });
}
function UserSetter(props) {
  const app = useStackApp();
  useEffect(() => {
    const promise = (async () => await props.userJsonPromise)();
    app[stackAppInternalsSymbol].setCurrentUser(promise);
  }, []);
  return null;
}
export {
  StackContext,
  StackProviderClient,
  UserSetter
};
//# sourceMappingURL=stack-provider-client.js.map