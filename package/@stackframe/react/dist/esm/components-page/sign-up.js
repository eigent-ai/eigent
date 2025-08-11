"use client";
"use client";

// src/components-page/sign-up.tsx
import { AuthPage } from "./auth-page";
import { jsx } from "react/jsx-runtime";
function SignUp(props) {
  return /* @__PURE__ */ jsx(
    AuthPage,
    {
      fullPage: !!props.fullPage,
      type: "sign-up",
      automaticRedirect: !!props.automaticRedirect,
      noPasswordRepeat: props.noPasswordRepeat,
      extraInfo: props.extraInfo,
      firstTab: props.firstTab
    }
  );
}
export {
  SignUp
};
//# sourceMappingURL=sign-up.js.map