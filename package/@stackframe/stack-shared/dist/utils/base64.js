"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/base64.tsx
var base64_exports = {};
__export(base64_exports, {
  fileToBase64: () => fileToBase64,
  validateBase64Image: () => validateBase64Image
});
module.exports = __toCommonJS(base64_exports);
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });
}
function validateBase64Image(base64) {
  const base64ImageRegex = /^data:image\/(png|jpg|jpeg|gif|bmp|webp);base64,[A-Za-z0-9+/]+={0,2}$|^[A-Za-z0-9+/]+={0,2}$/;
  return base64ImageRegex.test(base64);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  fileToBase64,
  validateBase64Image
});
//# sourceMappingURL=base64.js.map