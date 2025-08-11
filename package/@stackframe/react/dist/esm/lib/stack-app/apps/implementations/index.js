// src/lib/stack-app/apps/implementations/index.ts
import { scrambleDuringCompileTime } from "@stackframe/stack-shared/dist/utils/compile-time";
import { _StackAdminAppImplIncomplete } from "./admin-app-impl";
import { _StackClientAppImplIncomplete } from "./client-app-impl";
import { _StackServerAppImplIncomplete } from "./server-app-impl";
function complete() {
  _StackClientAppImplIncomplete.LazyStackAdminAppImpl.value = _StackAdminAppImplIncomplete;
  return {
    _StackAdminAppImpl: scrambleDuringCompileTime(_StackAdminAppImplIncomplete),
    _StackClientAppImpl: scrambleDuringCompileTime(_StackClientAppImplIncomplete),
    _StackServerAppImpl: scrambleDuringCompileTime(_StackServerAppImplIncomplete)
  };
}
var {
  _StackAdminAppImpl,
  _StackClientAppImpl,
  _StackServerAppImpl
} = complete();
export {
  _StackAdminAppImpl,
  _StackClientAppImpl,
  _StackServerAppImpl
};
//# sourceMappingURL=index.js.map