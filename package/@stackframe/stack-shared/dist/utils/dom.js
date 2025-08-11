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

// src/utils/dom.tsx
var dom_exports = {};
__export(dom_exports, {
  hasClickableParent: () => hasClickableParent
});
module.exports = __toCommonJS(dom_exports);
function hasClickableParent(element) {
  const parent = element.parentElement;
  if (!parent) return false;
  if (parent.dataset.n2Clickable) return true;
  return hasClickableParent(element.parentElement);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  hasClickableParent
});
//# sourceMappingURL=dom.js.map