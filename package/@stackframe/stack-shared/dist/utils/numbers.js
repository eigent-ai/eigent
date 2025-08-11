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

// src/utils/numbers.tsx
var numbers_exports = {};
__export(numbers_exports, {
  numberCompare: () => numberCompare,
  prettyPrintWithMagnitudes: () => prettyPrintWithMagnitudes,
  toFixedMax: () => toFixedMax
});
module.exports = __toCommonJS(numbers_exports);
var magnitudes = [
  [1e15, "trln"],
  [1e12, "bln"],
  [1e9, "bn"],
  [1e6, "M"],
  [1e3, "k"]
];
function prettyPrintWithMagnitudes(num) {
  if (typeof num !== "number") throw new Error("Expected a number");
  if (Number.isNaN(num)) return "NaN";
  if (num < 0) return "-" + prettyPrintWithMagnitudes(-num);
  if (!Number.isFinite(num)) return "\u221E";
  for (const [magnitude, suffix] of magnitudes) {
    if (num >= magnitude) {
      return toFixedMax(num / magnitude, 1) + suffix;
    }
  }
  return toFixedMax(num, 1);
}
function toFixedMax(num, maxDecimals) {
  return num.toFixed(maxDecimals).replace(/\.?0+$/, "");
}
function numberCompare(a, b) {
  return Math.sign(a - b);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  numberCompare,
  prettyPrintWithMagnitudes,
  toFixedMax
});
//# sourceMappingURL=numbers.js.map