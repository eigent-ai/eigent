// src/utils/uuids.tsx
import { generateRandomValues } from "./crypto";
function generateUuid() {
  return "10000000-1000-4000-8000-100000000000".replace(
    /[018]/g,
    (c) => (+c ^ generateRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16)
  );
}
function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(str);
}
export {
  generateUuid,
  isUuid
};
//# sourceMappingURL=uuids.js.map