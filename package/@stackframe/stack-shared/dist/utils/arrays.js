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

// src/utils/arrays.tsx
var arrays_exports = {};
__export(arrays_exports, {
  enumerate: () => enumerate,
  findLastIndex: () => findLastIndex,
  groupBy: () => groupBy,
  isShallowEqual: () => isShallowEqual,
  outerProduct: () => outerProduct,
  range: () => range,
  rotateLeft: () => rotateLeft,
  rotateRight: () => rotateRight,
  shuffle: () => shuffle,
  typedIncludes: () => typedIncludes,
  unique: () => unique
});
module.exports = __toCommonJS(arrays_exports);
var import_math = require("./math");
function typedIncludes(arr, item) {
  return arr.includes(item);
}
function enumerate(arr) {
  return arr.map((item, index) => [index, item]);
}
function isShallowEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function findLastIndex(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return i;
  }
  return -1;
}
function groupBy(arr, key) {
  const result = /* @__PURE__ */ new Map();
  for (const item of arr) {
    const k = key(item);
    if (result.get(k) === void 0) result.set(k, []);
    result.get(k).push(item);
  }
  return result;
}
function range(startInclusive, endExclusive, step) {
  if (endExclusive === void 0) {
    endExclusive = startInclusive;
    startInclusive = 0;
  }
  if (step === void 0) step = 1;
  const result = [];
  for (let i = startInclusive; step > 0 ? i < endExclusive : i > endExclusive; i += step) {
    result.push(i);
  }
  return result;
}
function rotateLeft(arr, n) {
  if (arr.length === 0) return [];
  const index = (0, import_math.remainder)(n, arr.length);
  return [...arr.slice(index), ...arr.slice(0, index)];
}
function rotateRight(arr, n) {
  return rotateLeft(arr, -n);
}
function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function outerProduct(arr1, arr2) {
  return arr1.flatMap((item1) => arr2.map((item2) => [item1, item2]));
}
function unique(arr) {
  return [...new Set(arr)];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  enumerate,
  findLastIndex,
  groupBy,
  isShallowEqual,
  outerProduct,
  range,
  rotateLeft,
  rotateRight,
  shuffle,
  typedIncludes,
  unique
});
//# sourceMappingURL=arrays.js.map