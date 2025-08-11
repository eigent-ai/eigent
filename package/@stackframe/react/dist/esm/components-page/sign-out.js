"use client";
"use client";

// src/components-page/sign-out.tsx
import { cacheFunction } from "@stackframe/stack-shared/dist/utils/caches";
import React from "react";
import { useUser } from "..";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { jsx } from "react/jsx-runtime";
var cacheSignOut = cacheFunction(async (user) => {
  return await user.signOut();
});
function SignOut(props) {
  const user = useUser();
  if (user) {
    React.use(cacheSignOut(user));
  }
  return /* @__PURE__ */ jsx(PredefinedMessageCard, { type: "signedOut", fullPage: props.fullPage });
}
export {
  SignOut
};
//# sourceMappingURL=sign-out.js.map