// src/helpers/password.ts
import { KnownErrors } from "..";
var minLength = 8;
var maxLength = 70;
function getPasswordError(password) {
  if (password.length < minLength) {
    return new KnownErrors.PasswordTooShort(minLength);
  }
  if (password.length > maxLength) {
    return new KnownErrors.PasswordTooLong(maxLength);
  }
  return void 0;
}
export {
  getPasswordError
};
//# sourceMappingURL=password.js.map