// src/components-page/sign-in.tsx
import { AuthPage } from "./auth-page";
import { jsx } from "react/jsx-runtime";
function SignIn(props) {
  return /* @__PURE__ */ jsx(
    AuthPage,
    {
      fullPage: !!props.fullPage,
      type: "sign-in",
      automaticRedirect: !!props.automaticRedirect,
      extraInfo: props.extraInfo,
      firstTab: props.firstTab
    }
  );
}
export {
  SignIn
};
//# sourceMappingURL=sign-in.js.map